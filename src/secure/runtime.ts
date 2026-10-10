import { FileSystemAdapter, Notice, TFile, type App } from 'obsidian';
import { randomUUID } from 'crypto';
import type { DashboardColumn } from '../types';
import { recordDiagnostic } from './diagnostics';

export type Box = { nonce: string; ciphertext: string };
export type AssetRef = { id: string; key: string; link: string; name: string; mime: string };
export type Payload = { raw: string; title?: string; definition?: Partial<DashboardColumn>; assets: AssetRef[] };
export type Envelope = {format:string;version:number;id:string;domain:{salt:string;iterations:number};blocks:Array<{id:string;kind:string;key:Box;data:Box}>;manifest:Box};
export const TEMP_ROOT = '周记/_临时解密';
export const PROTECTED_ROOT = '周记';
export function envelope(text: string): Envelope {
  if(text.length>12*1024*1024)throw Error('加密文件过大');
  const e=JSON.parse(text);
  if(e.format!=='apex-protected'||![1,2].includes(e.version)||!Array.isArray(e.blocks)||e.blocks.length>512)throw Error('加密格式不支持');
  return e;
}
export function safeName(name:string):string {
  const base=name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,110);
  return !base||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(base)?'周记':base;
}
export class CryptoWorker {
  private worker:Worker|null=null;
  private starting:Promise<Worker>|null=null;
  private generation=0;
  private workerUrl:string|null=null;
  private seq=0;
  private pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void}>();
  constructor(private app:App,private pluginDir:string){}
  private getWorker():Promise<Worker>{
    if(this.worker)return Promise.resolve(this.worker);
    if(this.starting)return this.starting;
    const generation=this.generation;
    const starting=(async()=>{
      const code=await this.app.vault.adapter.read(this.pluginDir+'/secure-worker.js');
      if(generation!==this.generation)throw Error('解锁会话已结束');
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));
      let worker:Worker;
      try{worker=new window.Worker(url);}catch(error){URL.revokeObjectURL(url);throw error;}
      this.worker=worker;this.workerUrl=url;
      worker.addEventListener('message',event=>{if(this.worker!==worker)return;const m=event.data,p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);});
      worker.addEventListener('error',event=>{if(this.worker===worker){void recordDiagnostic(this.app,'worker-error',event.error??new Error(event.message));this.stop('加密后台任务异常，未保存修改请勿关闭');}});
      worker.addEventListener('messageerror',()=>{if(this.worker===worker)this.stop('加密后台通信异常，未保存修改请勿关闭');});
      return worker;
    })();
    this.starting=starting;
    void starting.then(()=>{if(this.starting===starting)this.starting=null;},()=>{if(this.starting===starting)this.starting=null;});
    return starting;
  }
  async call<T=any>(op:string,args:any={}):Promise<T>{
    const generation=this.generation,worker=await this.getWorker();
    if(generation!==this.generation||this.worker!==worker)throw Error('解锁会话已结束');
    const id=++this.seq;
    return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{worker.postMessage({id,op,args});}catch(error){this.pending.delete(id);reject(error as Error);}});
  }
  stop(message='解锁会话已结束'):void{
    this.generation++;this.starting=null;const worker=this.worker;this.worker=null;
    for(const p of this.pending.values())p.reject(new Error(message));this.pending.clear();
    worker?.terminate();if(this.workerUrl)URL.revokeObjectURL(this.workerUrl);this.workerUrl=null;
  }
}
export class ProtectedStore {
  private queues=new Map<string,Promise<void>>();
  constructor(readonly app:App,readonly crypto:CryptoWorker){}
  async read(path:string):Promise<string>{return this.app.vault.adapter.read(path);}
  async mkdir(path:string):Promise<void>{
    let current='';for(const part of path.split('/')){if(!part||part==='.'||part==='..')throw Error('路径非法');current=current?current+'/'+part:part;if(!await this.app.vault.adapter.exists(current))await this.app.vault.createFolder(current);}
  }
  async namedPath(title:string,except?:string):Promise<string>{
    const name=safeName(title);let path=PROTECTED_ROOT+'/'+name+'.apexenc',n=2;
    while(path!==except&&await this.app.vault.adapter.exists(path))path=PROTECTED_ROOT+'/'+name+'-'+n+++'.apexenc';
    return path;
  }
  async create(text:string,title?:string):Promise<string>{
    const e=envelope(text);await this.mkdir(PROTECTED_ROOT);
    return this.enqueue('@create',async()=>{const path=title?await this.namedPath(title):PROTECTED_ROOT+'/'+e.id+'.apexenc';await this.app.vault.create(path,text);return path;});
  }
  enqueue<T>(path:string,run:()=>Promise<T>):Promise<T>{
    const previous=this.queues.get(path)??Promise.resolve();
    const result=previous.catch(()=>{}).then(run);
    const tail=result.then(()=>{},()=>{});this.queues.set(path,tail);
    void tail.then(()=>{if(this.queues.get(path)===tail)this.queues.delete(path);});return result;
  }
  async replace(path:string,expected:string,next:string):Promise<void>{
    envelope(next);
    const file=this.app.vault.getAbstractFileByPath(path);
    if(!(file instanceof TFile))throw Error('加密周记不存在，禁止自动创建空白替代文件');
    // Vault.process provides the compare-and-update boundary for in-process writers.
    await this.app.vault.process(file,current=>{if(current!==expected)throw Error('文件已由其他窗口或 Git 更新，请保留修改并重新打开');return next;});
    if(await this.read(path)!==next)throw Error('写入校验失败，尚未锁定');
  }
  async saveBlock(path:string,blockId:string,expectedBlock:string,token:string,payload:Payload):Promise<string>{
    return this.enqueue(path,async()=>{
      const current=await this.read(path),e=envelope(current),b=e.blocks.find(x=>x.id===blockId);
      if(!b||JSON.stringify(b)!==expectedBlock)throw Error('该分区存在外部修改，请先处理冲突');
      const next=await this.crypto.call<string>('save-block',{text:current,token,payload});
      await this.replace(path,current,next);return JSON.stringify(envelope(next).blocks.find(x=>x.id===blockId));
    });
  }
  async putAsset(bytes:Uint8Array,name:string,link:string,mime:string):Promise<AssetRef>{
    const {asset,key}=await this.crypto.call('asset-encrypt',{bytes});
    const folder=PROTECTED_ROOT+'/_assets';await this.mkdir(folder);
    await this.app.vault.create(folder+'/'+asset.id+'.apexasset',JSON.stringify(asset));
    return {id:asset.id,key,name:safeName(name),link,mime};
  }
  async getAsset(ref:AssetRef):Promise<Uint8Array>{
    if(!/^[a-f0-9-]{36}$/.test(ref.id))throw Error('附件 ID 无效');
    const asset=JSON.parse(await this.read(PROTECTED_ROOT+'/_assets/'+ref.id+'.apexasset'));
    return this.crypto.call('asset-decrypt',{asset,ref});
  }
}
export function report(error:unknown):void {new Notice(error instanceof Error?error.message:'操作失败，原文件保留',10000);}
export const freshId = randomUUID;
