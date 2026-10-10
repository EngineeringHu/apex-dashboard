import { FileSystemAdapter, MarkdownView, Notice, TFile } from 'obsidian';
import { execFile } from 'child_process';
import { lstat, realpath, rmdir } from 'fs/promises';
import * as path from 'path';
import { parse } from '../parser';
import { askPassword } from './dialogs';
import { TEMP_ROOT, envelope, safeName, freshId, type Payload, type AssetRef } from './runtime';
import type { SecureController } from './controller';

type ExportedAsset={work:string;from:string;to:string;hash:string};
type Entry={source:string;work:string;baselineHash:string;initialHash:string;sealed?:boolean;assets?:ExportedAsset[]};
type Journal={version:1;id:string;directory:string;entries:Entry[];stage:string};
type Handle={token:string;expected:string;title:string;assets:AssetRef[];original:string};
const JOURNAL='.apex-protected-session.json';
const pause=(ms:number)=>new Promise(resolve=>window.setTimeout(resolve,ms));
export class PlaintextSession {
  journal:Journal|null=null;
  private handles=new Map<string,Handle>();
  busy=false;cancelled=false;
  private originalDvStore:((...args:any[])=>any)|null=null;
  private originalDvFinish:((...args:any[])=>any)|null=null;
  private dvPending=new Set<Promise<any>>();
  private blockIndex=false;
  private checkpointTimer:number|null=null;
  private checkpointPending:Promise<void>=Promise.resolve();
  get active():boolean{return this.journal!==null||this.busy;}
  constructor(readonly controller:SecureController){}
  private get app(){return this.controller.plugin.app;}
  private get adapter(){return this.app.vault.adapter;}
  private assertPath(p:string):void{
    const directory=this.journal?.directory;
    if(!directory||!p.startsWith(directory+'/')||p.split('/').some(x=>x==='..'||x==='.')||p.includes('\\'))throw Error('临时路径越界，拒绝操作');
  }
  private async assertDiskPath(p:string):Promise<void>{
    if(!(this.adapter instanceof FileSystemAdapter))throw Error('需要桌面文件系统');
    const base=await realpath(this.adapter.getBasePath());
    let current=base;
    for(const segment of p.split('/')){if(segment==='..'||segment==='.'||!segment)throw Error('路径非法');current=path.join(current,segment);
      try{const stat=await lstat(current);if(stat.isSymbolicLink())throw Error('临时工作目录不能包含符号链接或 junction');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    }
    const relative=path.relative(base,current);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('临时路径越界');
  }
  async recover():Promise<void>{
    if(!await this.adapter.exists(JOURNAL))return;
    const j=JSON.parse(await this.adapter.read(JOURNAL)) as Journal;
    if(j.version!==1||!/^[-a-f0-9]{36}$/.test(j.id)||j.directory!==TEMP_ROOT+'/'+j.id||!Array.isArray(j.entries))throw Error('恢复日志无效，请手动保留现场');
    this.journal=j;
    for(const e of j.entries){this.assertPath(e.work);if(!/^周记\/[^/\\]+\.apexenc$/.test(e.source)||e.source.split('/').some(p=>p==='..'||p==='.'))throw Error('恢复来源路径无效');}
    this.installDvGuard();this.controller.status('旧版有遗留明文：请执行“完成旧版遗留数据恢复”');
  }
  private async saveJournal():Promise<void>{if(this.journal)await this.adapter.write(JOURNAL,JSON.stringify(this.journal));}
  private async removeEmptyDirectory(directory:string):Promise<void>{
    await this.assertDiskPath(directory);
    // Obsidian 1.13.7's adapter.rmdir(path, false) calls fs.rm and fails with
    // EISDIR on Windows. Native rmdir is non-recursive and refuses new files.
    await rmdir((this.adapter as FileSystemAdapter).getFullPath(directory));
  }
  private async verifyGit():Promise<void>{
    if(!(this.adapter instanceof FileSystemAdapter))throw Error('需要桌面文件系统');
    const cwd=this.adapter.getBasePath();
    const git=(args:string[])=>new Promise<number>((resolve,reject)=>execFile('git',['-c','safe.directory='+cwd,...args],{cwd,windowsHide:true},error=>{if(!error)resolve(0);else if(error.code===1)resolve(1);else reject(Error('Git 忽略检查未通过，请按使用说明配置'));}));
    if(await git(['ls-files','--error-unmatch','--',TEMP_ROOT])===0)throw Error('临时目录已被 Git 跟踪，先处理索引后再解密');
    if(await git(['check-ignore','--quiet',TEMP_ROOT+'/probe.md'])!==0)throw Error('临时目录尚未加入 Git 忽略规则');
  }
  async start(includeAssets=false):Promise<void>{
    await this.controller.credentials.assertReady();
    if(this.active)throw Error('已有临时会话，请先结束或恢复');
    const files=this.controller.files();if(!files.length)throw Error('还没有加密周记，请先创建测试周记');
    await this.verifyGit();await this.controller.lockAll();
    const password=await askPassword(this.app,'临时解密全部：此期间磁盘可读明文');if(password===null)return;
    this.busy=true;this.cancelled=false;const id=freshId();
    this.journal={version:1,id,directory:TEMP_ROOT+'/'+id,entries:[],stage:'opening'};
    try{
      await this.assertDiskPath(this.journal.directory);await this.controller.store.mkdir(this.journal.directory);await this.saveJournal();this.installDvGuard();
      let domainToken:string|undefined;
      for(const file of files){
        if(this.cancelled)break;
        const expected=await this.controller.store.read(file.path),opened=await this.controller.crypto.call('open-all',{text:expected,password,domainToken});domainToken=opened.token;
        const work=this.journal.directory+'/'+safeName(opened.title)+'-'+envelope(expected).id.slice(0,8)+'.md';this.assertPath(work);
        const entry:Entry={source:file.path,work,baselineHash:await this.controller.crypto.call<string>('hash',{value:expected}),initialHash:await this.controller.crypto.call<string>('hash',{value:opened.markdown}),assets:[]};
        this.journal.entries.push(entry);await this.saveJournal();
        this.handles.set(file.path,{token:opened.token,expected,title:opened.title,assets:opened.payloads.flatMap((p:Payload)=>p.assets),original:opened.markdown});
        let markdown=opened.markdown;
        if(includeAssets){
          for(const ref of this.handles.get(file.path)!.assets){
            if(entry.assets!.some(a=>a.from===ref.link))continue;
            const bytes=await this.controller.store.getAsset(ref);
            const ext=ref.name.match(/\.[a-z0-9]{1,10}$/i)?.[0]??'.bin';
            const assetPath=this.journal.directory+'/assets/'+ref.id+ext;
            this.assertPath(assetPath);await this.assertDiskPath(assetPath);await this.controller.store.mkdir(this.journal.directory+'/assets');
            const relative='assets/'+ref.id+ext;
            const to=ref.link.startsWith('![[')?'![['+relative+']]':ref.link.startsWith('[[')?'[['+relative+']]':(ref.link.startsWith('!')?'!':'')+'[]('+relative+')';
            entry.assets!.push({work:assetPath,from:ref.link,to,hash:await this.controller.crypto.call('hash',{value:bytes})});await this.saveJournal();
            if(!await this.adapter.exists(assetPath))await this.app.vault.createBinary(assetPath,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
            markdown=markdown.split(ref.link).join(to);
          }
        }
        await this.app.vault.create(work,markdown);
        this.controller.status('临时明文已开启 · '+this.journal.entries.length+'/'+files.length+' 篇');
        await pause(120);
      }
      this.journal.stage='active';await this.saveJournal();
      await this.waitIndex();
      this.controller.status('临时明文已开启 · '+this.journal.entries.length+' 篇 · 点击结束');
      new Notice('已生成临时 Markdown，可用原生搜索和 Dataview；结束时请使用专用锁定命令。',10000);
    }catch(error){this.controller.status('临时会话未完成，可能有明文：请结束或恢复');throw error;}
    finally{this.busy=false;}
    if(this.cancelled)await this.finish();
  }
  cancel():void{this.cancelled=true;this.controller.status('正在停止新增解密，已有明文将保全并清理');}
  changed(file:TFile):void{
    if(!this.journal||this.busy||this.journal.stage!=='active'||!this.isTemp(file.path)||this.checkpointTimer!==null)return;
    this.checkpointTimer=window.setTimeout(()=>{this.checkpointTimer=null;this.checkpointPending=this.checkpointPending.then(async()=>{
      if(this.busy||this.journal?.stage!=='active')return;
      for(const entry of this.journal.entries){const handle=this.handles.get(entry.source);if(handle&&await this.adapter.exists(entry.work))await this.checkpoint(entry,handle);}
    }).catch(()=>{this.controller.status('临时修改的密文检查点失败；结束前请重试保存');});},1000);
  }
  private normalize(markdown:string,entry:Entry):string{for(const asset of entry.assets??[])markdown=markdown.split(asset.to).join(asset.from);return markdown;}
  private async checkpoint(entry:Entry,handle:Handle):Promise<void>{
    const markdown=this.normalize(await this.adapter.read(entry.work),entry);
    if(markdown===handle.original)return;
    const current=await this.controller.store.read(entry.source);
    if(await this.controller.crypto.call<string>('hash',{value:current})!==entry.baselineHash)throw Error('正式密文存在外部修改');
    const definitions=parse(markdown).columns.map(({cards,tableContent,...def})=>def);
    const next=await this.controller.crypto.call<string>('save-all',{text:current,token:handle.token,markdown,title:handle.title,assets:handle.assets,definitions});
    await this.controller.store.enqueue(entry.source,()=>this.controller.store.replace(entry.source,current,next));
    entry.baselineHash=await this.controller.crypto.call('hash',{value:next});handle.expected=next;handle.original=markdown;await this.saveJournal();
  }
  private async waitIndex():Promise<void>{
    const paths=this.journal!.entries.map(e=>e.work);const until=Date.now()+15000;
    while(Date.now()<until){
      const dv=(this.app as any).plugins?.plugins?.dataview;
      if(paths.every(p=>{const file=this.app.vault.getAbstractFileByPath(p);return file instanceof TFile&&this.app.metadataCache.getFileCache(file)&&(!dv||dv.index?.pages?.has(p));}))return;
      if(this.cancelled)return;await pause(200);
    }
    new Notice('文件已生成，但索引尚未全部就绪；Dataview 结果暂可能不完整。',10000);
  }
  private isTemp(p:string):boolean{return p===TEMP_ROOT||p.startsWith(TEMP_ROOT+'/');}
  installDvGuard():void{
    const dv=(this.app as any).plugins?.plugins?.dataview;
    if(!dv||this.originalDvStore)return;
    if(dv.manifest?.version!=='0.5.68'||typeof dv.index?.persister?.storeFile!=='function'||typeof dv.index?.finish!=='function')throw Error('此 Dataview 版本的缓存清理尚未验证；请先停用 Dataview 或使用 0.5.68');
    const index=dv.index,persister=index.persister;this.originalDvStore=persister.storeFile;this.originalDvFinish=index.finish;
    const originalStore=this.originalDvStore!,originalFinish=this.originalDvFinish!,self=this;
    // Never persist temporary notes; ordinary notes retain their original caching behavior.
    persister.storeFile=function(p:string,...args:any[]){if(self.isTemp(p))return Promise.resolve();const result=Promise.resolve(originalStore.apply(this,[p,...args]));self.dvPending.add(result);void result.finally(()=>self.dvPending.delete(result)).catch(()=>{});return result;};
    index.finish=function(file:TFile,...args:any[]){if(self.isTemp(file.path)&&(self.blockIndex||!self.app.vault.getAbstractFileByPath(file.path)))return;return originalFinish.apply(this,[file,...args]);};
  }
  private async cleanDv():Promise<void>{
    const dv=(this.app as any).plugins?.plugins?.dataview;if(!dv)return;
    const index=dv.index;if(!index?.persister?.persister)throw Error('Dataview 缓存接口不兼容，清理未完成');
    await Promise.allSettled([...this.dvPending]);
    for(const key of [...index.pages.keys()])if(this.isTemp(key)){index.pages.delete(key);index.tags.delete(key);index.etags.delete(key);index.links.delete(key);}
    const storage=index.persister.persister;
    for(const key of await storage.keys())if(key.startsWith('file:')&&this.isTemp(key.slice(5)))await storage.removeItem(key);
    index.touch();await pause(350);
    if([...index.pages.keys()].some((p:any)=>this.isTemp(p)))throw Error('Dataview 索引仍含临时记录');
  }
  async finish():Promise<void>{
    if(this.busy){this.cancel();return;}
    if(!this.journal)return;
    let password:string|null=null;
    if(this.journal.entries.some(e=>!e.sealed&&!this.handles.has(e.source))){password=await askPassword(this.app,'恢复并加密临时修改');if(password===null)return;}
    this.busy=true;this.blockIndex=true;
    try{
      if(this.checkpointTimer!==null){window.clearTimeout(this.checkpointTimer);this.checkpointTimer=null;}await this.checkpointPending;
      this.journal.stage='closing';await this.saveJournal();this.controller.status('正在保存密文并清理，请勿关闭 Obsidian');
      for(const leaf of this.app.workspace.getLeavesOfType('markdown')){
        const view=leaf.view;if(view instanceof MarkdownView&&view.file&&this.isTemp(view.file.path)){await view.save();await leaf.setViewState({type:'empty'});}
      }
      for(const entry of this.journal.entries){
        this.assertPath(entry.work);await this.assertDiskPath(entry.work);
        if(!await this.adapter.exists(entry.work)){if(entry.sealed)continue;entry.sealed=true;await this.saveJournal();continue;}
        const raw=await this.adapter.read(entry.work),markdown=this.normalize(raw,entry);let handle=this.handles.get(entry.source);
        const current=await this.controller.store.read(entry.source),currentHash=await this.controller.crypto.call<string>('hash',{value:current});
        if(currentHash!==entry.baselineHash)throw Error('正式密文存在外部修改，临时文件已保留，请先处理冲突');
        if(!handle){const all=await this.controller.crypto.call('open-all',{text:current,password});handle={token:all.token,expected:current,title:all.title,assets:all.payloads.flatMap((p:Payload)=>p.assets),original:all.markdown};this.handles.set(entry.source,handle);}
        if(markdown!==handle.original){
          const definitions=parse(markdown).columns.map(({cards,tableContent,...def})=>def);
          const next=await this.controller.crypto.call<string>('save-all',{text:current,token:handle.token,markdown,title:handle.title,assets:handle.assets,definitions});
          await this.controller.store.enqueue(entry.source,()=>this.controller.store.replace(entry.source,current,next));
          entry.baselineHash=await this.controller.crypto.call('hash',{value:next});handle.expected=next;handle.original=markdown;await this.saveJournal();
        }
        if(await this.adapter.read(entry.work)!==raw)throw Error('临时文件仍在写入，保留现场，请重试结束');
        const file=this.app.vault.getAbstractFileByPath(entry.work);
        if(file instanceof TFile)await this.app.vault.delete(file,true);else await this.adapter.remove(entry.work);
        entry.sealed=true;await this.saveJournal();await pause(60);
      }
      const assets=new Map<string,ExportedAsset>();for(const e of this.journal.entries)for(const a of e.assets??[])assets.set(a.work,a);
      for(const a of assets.values()){
        this.assertPath(a.work);await this.assertDiskPath(a.work);if(!await this.adapter.exists(a.work))continue;
        const bytes=new Uint8Array(await this.adapter.readBinary(a.work));
        if(await this.controller.crypto.call<string>('hash',{value:bytes})!==a.hash)throw Error('临时附件已修改，已保留该附件。请移到库外保存，再重试结束；受保护附件可通过专用入口重新导入');
        const file=this.app.vault.getAbstractFileByPath(a.work);if(file instanceof TFile)await this.app.vault.delete(file,true);else await this.adapter.remove(a.work);
      }
      const assetFolder=this.journal.directory+'/assets';
      if(await this.adapter.exists(assetFolder)){const list=await this.adapter.list(assetFolder);if(!list.files.length&&!list.folders.length)await this.removeEmptyDirectory(assetFolder);}
      await this.cleanDv();
      const remaining=await this.adapter.list(this.journal.directory);
      if(remaining.files.length||remaining.folders.length)throw Error('临时目录有新增或未处理文件，已保留；请先导出/处理后再结束');
      await this.removeEmptyDirectory(this.journal.directory);
      await this.adapter.remove(JOURNAL);
      this.handles.clear();this.journal=null;await this.controller.crypto.call('clear');this.controller.crypto.stop();
      this.controller.status('周记已锁定');new Notice('临时文件已清理，周记恢复密文模式。');
    }catch(error){this.controller.status('清理未完成 · 可能仍有明文 · 点击重试');throw error;}
    finally{this.busy=false;if(this.journal?.stage!=='closing')this.blockIndex=false;}
  }
  unload():void{
    if(this.checkpointTimer!==null)window.clearTimeout(this.checkpointTimer);
    const dv=(this.app as any).plugins?.plugins?.dataview;
    if(dv&&this.originalDvStore){dv.index.persister.storeFile=this.originalDvStore;dv.index.finish=this.originalDvFinish;}
    this.originalDvStore=null;this.originalDvFinish=null;
    if(this.active)new Notice('临时明文尚未清理，下次启用插件后请恢复并锁定。',15000);
  }
}
