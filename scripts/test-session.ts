import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { ProtectedStore, CryptoWorker, envelope } from '../src/secure/runtime';
import { PlaintextSession } from '../src/secure/session';
import { TFile, FileSystemAdapter } from 'obsidian';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

(globalThis as any).window={setTimeout,clearTimeout};
const memory=new Map<string,string>();const files=new Map<string,TFile>();const folders=new Set<string>();
const adapter:any={read:async(p:string)=>{if(!memory.has(p))throw Error('missing '+p);return memory.get(p)!;},write:async(p:string,s:string)=>{memory.set(p,s);},exists:async(p:string)=>memory.has(p)||folders.has(p),remove:async(p:string)=>{memory.delete(p);files.delete(p);},rmdir:async(p:string)=>{folders.delete(p);},list:async(p:string)=>({files:[...memory.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')),folders:[...folders].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/'))})};
const storeCache=new Map<string,any>();const pages=new Map<string,any>();
const index:any={pages,tags:new Map(),etags:new Map(),links:new Map(),touch(){},finish(file:TFile){pages.set(file.path,{});},persister:{storeFile:async(p:string,v:any)=>{storeCache.set('file:'+p,v);},persister:{keys:async()=>[...storeCache.keys()],removeItem:async(p:string)=>{storeCache.delete(p);}}}};
const dv={manifest:{version:'0.5.68'},index};
const app:any={vault:{adapter,getAbstractFileByPath:(p:string)=>files.get(p),createFolder:async(p:string)=>{folders.add(p);},create:async(p:string,s:string)=>{if(memory.has(p))throw Error('exists');const f=new TFile(p);memory.set(p,s);files.set(p,f);return f;},delete:async(f:TFile)=>{memory.delete(f.path);files.delete(f.path);},process:async(f:TFile,fn:(s:string)=>string)=>{memory.set(f.path,fn(memory.get(f.path)!));}},workspace:{getLeavesOfType:()=>[]},plugins:{plugins:{dataview:dv}}};
const worker=new Worker(path.resolve('dist/secure-worker.cjs'));let seq=0;
const crypto:any={call:(op:string,args:any={})=>new Promise((resolve,reject)=>{const id=++seq;const handler=(m:any)=>{if(m.id!==id)return;worker.off('message',handler);m.error?reject(Error(m.error)):resolve(m.result);};worker.on('message',handler);worker.postMessage({id,op,args});}),stop(){}};
const store=new ProtectedStore(app,crypto);let status='';
const controller:any={plugin:{app},store,crypto,status:(s:string)=>{status=s;}};
const password='Synthetic-session-password';
async function setup(markdown:string){
  const text=await crypto.call('create',{markdown,title:'测试标题',password});const source=await store.create(text);const all=await crypto.call('open-all',{text,password});
  const directory='周记/_临时解密/12345678-1234-4123-8123-123456789abc';folders.add(directory);const work=directory+'/测试.md';await app.vault.create(work,markdown);
  const session=new PlaintextSession(controller);session.journal={version:1,id:'12345678-1234-4123-8123-123456789abc',directory,stage:'active',entries:[{source,work,baselineHash:await crypto.call('hash',{value:text}),initialHash:await crypto.call('hash',{value:markdown})}]};
  (session as any).assertDiskPath=async()=>{};
  (session as any).removeEmptyDirectory=(p:string)=>adapter.rmdir(p,false);
  (session as any).handles.set(source,{token:all.token,expected:text,title:all.title,assets:[],original:markdown});
  memory.set('.apex-protected-session.json',JSON.stringify(session.journal));session.installDvGuard();return {session,source,work,text};
}
async function run(){try{
  const a=await setup('## A\n- [ ] first\n');memory.set(a.work,'## A\n- [x] changed\n');
  await index.persister.storeFile(a.work,{secret:'must-not-persist'});assert(!storeCache.has('file:'+a.work));
  storeCache.set('file:'+a.work,{old:'persisted'});storeCache.set('file:ordinary.md',{keep:true});pages.set(a.work,{});pages.set('ordinary.md',{});
  await a.session.finish();assert.equal(a.session.active,false);assert(!memory.has(a.work));assert(!storeCache.has('file:'+a.work));assert(storeCache.has('file:ordinary.md'));assert(pages.has('ordinary.md'));
  const recovered=await crypto.call('open-all',{text:memory.get(a.source),password});assert.equal(recovered.markdown,'## A\n- [x] changed\n');a.session.unload();
  const b=await setup('## No change\nExact bytes\r\n');await b.session.finish();assert.equal(memory.get(b.source),b.text);b.session.unload();
  const c=await setup('## Conflict\n');memory.set(c.source,c.text+' ');memory.set(c.work,'## Changed\n');await assert.rejects(()=>c.session.finish(),/外部修改/);assert(memory.has(c.work));assert(c.session.active);c.session.unload();
  const e=envelope(b.text);const block=e.blocks[1]!;const unlocked:any=await crypto.call('unlock',{text:b.text,password,blockId:block.id});
  await assert.rejects(()=>store.saveBlock(b.source,block.id,'stale',unlocked.token,unlocked.payload),/外部修改/);
  // Exercise the browser worker's source and message contract; the real Electron
  // constructor/lifecycle is covered separately by test-inapp.js.
  class BrowserWorker {
    private worker:Worker|null=null;private waiting:any[]=[];private terminated=false;
    private listeners=new Map<string,Array<(event:any)=>void>>();
    constructor(url:string){void fetch(url).then(r=>r.text()).then(code=>{
      if(this.terminated)return;
      this.worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={addEventListener:(name,fn)=>parentPort.on('message',data=>fn({data})),postMessage:data=>parentPort.postMessage(data)};\n`+code,{eval:true});
      this.worker.on('message',data=>this.emit('message',{data}));this.worker.on('error',error=>this.emit('error',{error,message:error.message}));
      for(const message of this.waiting)this.worker.postMessage(message);this.waiting=[];
    }).catch(error=>this.emit('error',{error,message:error.message}));}
    addEventListener(name:string,fn:(event:any)=>void){this.listeners.set(name,[...this.listeners.get(name)??[],fn]);}
    private emit(name:string,event:any){for(const fn of this.listeners.get(name)??[])fn(event);}
    postMessage(message:any){if(this.worker)this.worker.postMessage(message);else this.waiting.push(message);}
    terminate(){this.terminated=true;void this.worker?.terminate();}
  }
  (globalThis as any).window.Worker=BrowserWorker;
  const sessions=new CryptoWorker({...app,vault:{...app.vault,adapter:Object.assign(new FileSystemAdapter(),{read:()=>readFile('dist/secure-worker.js','utf8')})}},'.obsidian/plugins/apex-dashboard');
  await sessions.call('domain');sessions.stop();await sessions.call('domain');sessions.stop();
  const interrupted=sessions.call('domain');sessions.stop();await assert.rejects(()=>interrupted,/会话已结束/);
  console.log(JSON.stringify({passed:true,checks:'temporary-edit roundtrip, no-change no-Git-diff, cache suppression, scoped cleanup, conflict preserves plaintext, stale-save rejection, worker restart'}));
}finally{await worker.terminate();}}
void run().catch(error=>{console.error(error);process.exitCode=1;});
