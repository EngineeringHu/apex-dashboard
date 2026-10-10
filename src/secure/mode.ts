import { FileSystemAdapter, MarkdownView, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import { lstat, realpath, rmdir } from 'fs/promises';
import * as nodePath from 'path';
import type { SecureController } from './controller';
import { DashboardView, DASHBOARD_VIEW_TYPE } from '../view';
import { parse } from '../parser';
import { askPassword } from './dialogs';
import { envelope, freshId, safeName, PROTECTED_ROOT, type AssetRef, type Payload } from './runtime';
import { ProtectedIndexCleanup } from './index-cleanup';

export const MODE_FILE='.apex-weekly-mode.json';
const JOURNAL='.apex-weekly-mode-change.json',STAGING='.apex-weekly-mode-staging',ASSET_FOLDER=PROTECTED_ROOT+'/_附件';
type Entry={source:string;target:string;before:string;after:string;index:number};
type Asset={path:string;hash:string;id?:string};
type Change={version:1;id:string;enabled:boolean;previous:string|null;entries:Entry[];assets:Asset[]};
const wait=()=>new Promise(resolve=>window.setTimeout(resolve,0));

/** The switch converts real files. There is no timed plaintext session. */
export class WeeklyEncryptionMode {
  enabled=true;busy=false;pending=false;
  private guard:ProtectedIndexCleanup|null=null;
  constructor(private controller:SecureController){}
  private get app(){return this.controller.plugin.app;}
  private get adapter(){return this.app.vault.adapter;}
  plainFiles():TFile[]{
    const template=this.controller.templates.file()?.path;
    return this.app.vault.getMarkdownFiles().filter(f=>f.parent?.path===PROTECTED_ROOT&&f.path!==template);
  }
  async load():Promise<void>{
    if(await this.adapter.exists(MODE_FILE)){const mode=JSON.parse(await this.adapter.read(MODE_FILE));if(mode.version!==1||typeof mode.enabled!=='boolean')throw Error('周记加密开关配置无效');this.enabled=mode.enabled;}
    else this.enabled=(await this.controller.credentials.configured())||this.controller.workspaceFiles().length>0;
    this.pending=await this.adapter.exists(JOURNAL);
  }
  async assertReady():Promise<void>{if(this.busy||this.pending||await this.adapter.exists(JOURNAL)||this.busy)throw Error('周记加密切换尚未完成，请在设置中继续切换');}
  announce():void{if(this.pending){this.controller.status('周记加密切换未完成 · 请在设置中继续');new Notice('上次周记加密切换未完成，请到 Apex 设置中继续切换。',10000);}else this.controller.status(this.enabled?'周记加密：开启':'周记加密：关闭 · 普通 Markdown');}
  async setEnabled(enabled:boolean):Promise<void>{
    await this.assertReady();await this.controller.credentials.assertReady();
    if(this.controller.credentials.creating||this.controller.session.active)throw Error('请先完成正在进行的周记操作');
    let recipient=enabled?await this.controller.credentials.get():null;
    if(enabled&&!recipient){await this.controller.credentials.setup();recipient=await this.controller.credentials.get();if(!recipient)return;}
    if(this.busy)throw Error('切换正在进行');this.busy=true;
    let journal:Change|null=null,published=false,completed=false;
    try{
      const sources=enabled?this.plainFiles():this.controller.workspaceFiles();
      const password=!enabled&&sources.length?await askPassword(this.app,'关闭周记加密：转换为普通 Markdown'):null;
      if(!enabled&&sources.length&&password===null)return;
      await this.closeEditors(new Set([...this.plainFiles(),...this.controller.workspaceFiles()].map(f=>f.path)));
      const current=enabled?this.plainFiles():this.controller.workspaceFiles();
      journal={version:1,id:freshId(),enabled,previous:await this.adapter.exists(MODE_FILE)?await this.adapter.read(MODE_FILE):null,entries:[],assets:[]};
      if(enabled){this.guard=new ProtectedIndexCleanup(this.app,new Set(current.map(f=>f.path)));this.guard.install();}
      const dir=STAGING+'/'+journal.id;await this.ensureDirectory(STAGING);await this.ensureDirectory(dir);
      const reserved=new Set<string>(),assets=new Map<string,Asset>();
      if(enabled){
        const originals=new Map<string,TFile>();
        for(const file of current)for(const asset of this.linkedAssets(await this.app.vault.read(file),file.path))originals.set(asset.path,asset);
        await this.assertUnshared(new Set(originals.keys()),new Set(current.map(f=>f.path)));
        for(const file of originals.values()){await this.diskPath(file.path);assets.set(file.path,{path:file.path,hash:await this.hash(new Uint8Array(await this.app.vault.readBinary(file)))});}
      }
      for(const [index,file]of current.entries()){
        await this.diskPath(file.path);const raw=await this.app.vault.read(file);let staged=raw,output=raw,title=file.basename;
        if(enabled){
          const refs=await this.controller.importAssets(raw,file.path),definitions=parse(raw).columns.map(({cards,tableContent,...d})=>d);
          staged=await this.controller.crypto.call('create-public',{markdown:raw,title,recipient,definitions,assets:refs});output=staged;
        }else{
          const opened=await this.controller.crypto.call('open-all',{text:raw,password});
          try{
            if(/^[a-f0-9-]{36}$/.test(title)&&opened.title)title=opened.title;
            for(const ref of opened.payloads.flatMap((p:Payload)=>p.assets) as AssetRef[]){
              if(!assets.has(ref.id)){const bytes=await this.controller.store.getAsset(ref),hash=await this.hash(bytes);const path=await this.destination(ASSET_FOLDER,safeName(ref.id+'-'+ref.name),'',reserved);assets.set(ref.id,{path,hash,id:ref.id});}
            }
            output=this.restoreLinks(opened.markdown,opened.payloads.flatMap((p:Payload)=>p.assets),assets);
          }finally{await this.controller.crypto.call('drop',{token:opened.token});}
        }
        const target=await this.destination(PROTECTED_ROOT,title,enabled?'.apexenc':'.md',reserved);
        const entry={source:file.path,target,before:await this.hash(raw),after:await this.hash(output),index};
        await this.adapter.write(dir+'/'+index+'.apexenc',staged);
        if(await this.hash(await this.adapter.read(dir+'/'+index+'.apexenc'))!==await this.hash(staged))throw Error('转换暂存校验失败，原文件未删除');
        journal.entries.push(entry);this.controller.status('正在准备'+(enabled?'加密':'普通 Markdown')+'：'+(index+1)+'/'+current.length);await wait();
      }
      journal.assets=[...assets.values()];
      await this.preflight(journal);
      await this.adapter.write(JOURNAL,JSON.stringify(journal));published=true;this.pending=true;
      journal=JSON.parse(await this.adapter.read(JOURNAL));await this.commit(journal!,password);completed=true;
    }finally{
      this.busy=false;
      if(!published&&journal)await this.removeStages(journal);
      if(!this.pending){this.guard?.unload();this.guard=null;this.announce();}
    }
    if(completed&&journal){await this.openResult(journal);new Notice(enabled?'周记加密已开启，所有周记已转换并锁定。':'周记加密已关闭，现为普通 Markdown，搜索和 Dataview 可正常读取。',10000);}
  }
  private async hash(value:string|Uint8Array):Promise<string>{return this.controller.crypto.call('hash',{value});}
  private async destination(folder:string,title:string,extension:string,reserved:Set<string>):Promise<string>{
    const base=safeName(title);let path=folder+'/'+base+extension,n=2;
    while(reserved.has(path)||await this.adapter.exists(path))path=folder+'/'+base+'-'+n+++extension;
    reserved.add(path);return path;
  }
  private restoreLinks(markdown:string,refs:AssetRef[],assets:Map<string,Asset>):string{
    for(const ref of refs){const asset=assets.get(ref.id);if(!asset)throw Error('附件转换清单缺失');
      const wiki=ref.link.match(/^(!?)\[\[[^\]|]+(\|[^\]]*)?\]\]$/);
      const replacement=wiki?wiki[1]+'[['+asset.path+(wiki[2]??'')+']]':ref.link.replace(/\]\([^)]+\)$/,'](<'+asset.path+'>)');
      markdown=markdown.split(ref.link).join(replacement);
    }return markdown;
  }
  private linkedAssets(markdown:string,source:string):TFile[]{
    const out:TFile[]=[];
    for(const match of markdown.matchAll(/!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\(([^)]+)\)/g)){
      const target=(match[1]??match[2]??'').split('|')[0]!.split('#')[0]!.trim().replace(/^<|>$/g,'');
      if(/^(https?:|data:|file:)/i.test(target))continue;
      const f=this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(target),source);
      if(f instanceof TFile&&f.extension!=='md')out.push(f);
    }return out;
  }
  private async assertUnshared(assets:Set<string>,sources:Set<string>):Promise<void>{
    if(!assets.size)return;
    for(const file of this.app.vault.getMarkdownFiles())if(!sources.has(file.path)){
      if(this.linkedAssets(await this.app.vault.read(file),file.path).some(f=>assets.has(f.path)))throw Error('附件被其他笔记共用，未删除或转换：'+file.path+'。请为周记使用独立附件后重试。');await wait();
    }
  }
  private validPath(path:string):void{if(!path||path.includes('\\')||path.includes(':')||path.split('/').some(p=>!p||p.startsWith('.')))throw Error('转换路径非法');}
  private async diskPath(path:string):Promise<void>{
    if(!(this.adapter instanceof FileSystemAdapter))throw Error('周记加密需要桌面文件系统');
    const base=await realpath(this.adapter.getBasePath());let current=base;
    for(const part of path.split('/')){if(!part||part==='.'||part==='..'||part.includes(':')||part.includes('\\'))throw Error('转换路径越界');current=nodePath.join(current,part);try{if((await lstat(current)).isSymbolicLink())throw Error('转换路径不可包含符号链接或 junction');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    const relative=nodePath.relative(base,current);if(relative.startsWith('..')||nodePath.isAbsolute(relative))throw Error('转换路径越界');
  }
  private async ensureDirectory(path:string):Promise<void>{await this.diskPath(path);if(!await this.adapter.exists(path))await this.adapter.mkdir(path);}
  private async closeEditors(paths:Set<string>):Promise<void>{
    (document.activeElement as HTMLElement)?.blur();await this.controller.lockAll();
    const leaves:WorkspaceLeaf[]=[];this.app.workspace.iterateAllLeaves(l=>leaves.push(l));
    for(const leaf of leaves){const view=leaf.view;
      if(view instanceof DashboardView){if(paths.has(view.workspacePath())){await view.flushBeforeEncryption();await leaf.setViewState({type:'empty'});}}
      else if('file' in view&&view.file instanceof TFile&&paths.has(view.file.path)){if(view instanceof MarkdownView)await view.save();await leaf.setViewState({type:'empty'});}
    }
  }
  private async validate(j:Change):Promise<void>{
    if(j.version!==1||!/^[-a-f0-9]{36}$/.test(j.id)||typeof j.enabled!=='boolean'||!Array.isArray(j.entries)||!Array.isArray(j.assets)||!(j.previous===null||typeof j.previous==='string'))throw Error('加密切换恢复记录无效');
    const paths=new Set<string>();
    for(const [i,e]of j.entries.entries()){
      for(const p of [e.source,e.target]){this.validPath(p);if(p.split('/').length!==2||!p.startsWith(PROTECTED_ROOT+'/')||paths.has(p))throw Error('周记转换路径冲突');paths.add(p);await this.diskPath(p);}
      if(e.index!==i||!e.source.endsWith(j.enabled?'.md':'.apexenc')||!e.target.endsWith(j.enabled?'.apexenc':'.md'))throw Error('转换方向无效');
      await this.diskPath(STAGING+'/'+j.id+'/'+i+'.apexenc');
    }
    for(const asset of j.assets){this.validPath(asset.path);if(paths.has(asset.path))throw Error('附件路径重复');paths.add(asset.path);if(!j.enabled&&(!asset.path.startsWith(ASSET_FOLDER+'/')||!/^[a-f0-9-]{36}$/.test(asset.id??'')))throw Error('附件导出路径无效');await this.diskPath(asset.path);}
  }
  private async preflight(j:Change,requireOutputs=false):Promise<void>{
    await this.validate(j);
    const state=await this.adapter.exists(MODE_FILE)?await this.adapter.read(MODE_FILE):null;
    if(state!==j.previous&&state!==JSON.stringify({version:1,enabled:j.enabled})+'\n')throw Error('开关配置被外部修改，已停止切换');
    for(const e of j.entries){
      if(requireOutputs&&!await this.adapter.exists(e.target))throw Error('转换结果被外部移除，原文件保留');
      if(await this.adapter.exists(e.source)){if(await this.hash(await this.adapter.read(e.source))!==e.before)throw Error('原周记被外部修改，保留原文件：'+e.source);}
      else if(!await this.adapter.exists(e.target))throw Error('原文件和转换结果均缺失，停止恢复');
      if(await this.adapter.exists(e.target)&&await this.hash(await this.adapter.read(e.target))!==e.after)throw Error('目标文件存在其他内容，未覆盖：'+e.target);
      const staged=await this.adapter.read(STAGING+'/'+j.id+'/'+e.index+'.apexenc');envelope(staged);
      if(await this.hash(staged)!==(j.enabled?e.after:e.before))throw Error('转换暂存文件已改变');
    }
    if(j.enabled){
      for(const asset of j.assets)if(await this.adapter.exists(asset.path)&&await this.hash(new Uint8Array(await this.adapter.readBinary(asset.path)))!==asset.hash)throw Error('附件被外部修改，已保留：'+asset.path);
      await this.assertUnshared(new Set(j.assets.map(a=>a.path)),new Set(j.entries.map(e=>e.source)));
    }else for(const asset of j.assets){if(requireOutputs&&!await this.adapter.exists(asset.path))throw Error('导出附件被外部移除，原文件保留');if(await this.adapter.exists(asset.path)&&await this.hash(new Uint8Array(await this.adapter.readBinary(asset.path)))!==asset.hash)throw Error('导出附件存在其他内容，已停止覆盖');}
  }
  private async publish(path:string,content:string|Uint8Array,hash:string):Promise<void>{
    await this.diskPath(path);
    if(!await this.adapter.exists(path)){
      const parent=path.slice(0,path.lastIndexOf('/'));await this.ensureDirectory(parent);
      if(typeof content==='string')await this.app.vault.create(path,content);else await this.app.vault.createBinary(path,content.buffer.slice(content.byteOffset,content.byteOffset+content.byteLength) as ArrayBuffer);
    }
    const actual=typeof content==='string'?await this.adapter.read(path):new Uint8Array(await this.adapter.readBinary(path));
    if(await this.hash(actual)!==hash)throw Error('目标内容不同或写入校验失败，原文件未删除：'+path);
  }
  private async removeSource(path:string,hash:string,binary=false):Promise<void>{
    if(!await this.adapter.exists(path))return;await this.diskPath(path);
    const content=binary?new Uint8Array(await this.adapter.readBinary(path)):await this.adapter.read(path);
    if(await this.hash(content)!==hash)throw Error('文件仍在变化，停止删除：'+path);
    const file=this.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error('源文件未就绪，请重试切换');await this.app.vault.delete(file,true);
  }
  private async commit(j:Change,password:string|null):Promise<void>{
    await this.preflight(j);
    if(j.enabled&&!this.guard){this.guard=new ProtectedIndexCleanup(this.app,new Set(j.entries.map(e=>e.source)));this.guard.install();}
    const assets=new Map(j.assets.map(a=>[a.id!,a]));
    for(const e of j.entries){
      const staged=await this.adapter.read(STAGING+'/'+j.id+'/'+e.index+'.apexenc');let output=staged;
      if(!j.enabled){
        const opened=await this.controller.crypto.call('open-all',{text:staged,password});
        try{
          const refs=opened.payloads.flatMap((p:Payload)=>p.assets) as AssetRef[];
          output=this.restoreLinks(opened.markdown,refs,assets);
          for(const ref of refs){const asset=assets.get(ref.id)!;await this.publish(asset.path,await this.controller.store.getAsset(ref),asset.hash);}
        }finally{await this.controller.crypto.call('drop',{token:opened.token});}
      }
      if(await this.hash(output)!==e.after)throw Error('转换结果与已验证内容不同');
      await this.publish(e.target,output,e.after);this.controller.status('正在切换周记：'+(e.index+1)+'/'+j.entries.length);await wait();
    }
    // All outputs exist and authenticate before removing even the first source.
    await this.preflight(j,true);
    for(const e of j.entries)await this.removeSource(e.source,e.before);
    if(j.enabled){for(const asset of j.assets)await this.removeSource(asset.path,asset.hash,true);await this.guard?.clean();}
    await this.controller.plugin.finishWeeklyModeChange(j.entries.map(e=>e.source));
    await this.adapter.write(MODE_FILE,JSON.stringify({version:1,enabled:j.enabled})+'\n');
    if(JSON.parse(await this.adapter.read(MODE_FILE)).enabled!==j.enabled)throw Error('开关配置保存失败');
    await this.adapter.remove(JOURNAL);this.pending=false;this.enabled=j.enabled;await this.removeStages(j);
    this.guard?.unload();this.guard=null;
  }
  private async removeStages(j:Change):Promise<void>{
    for(const e of j.entries)try{await this.adapter.remove(STAGING+'/'+j.id+'/'+e.index+'.apexenc');}catch{/* encrypted staging only */}
    try{const directory=STAGING+'/'+j.id;await this.diskPath(directory);const contents=await this.adapter.list(directory);if(!contents.files.length&&!contents.folders.length)await rmdir((this.adapter as FileSystemAdapter).getFullPath(directory));}catch{/* Never recursively remove unknown content. */}
  }
  async resume():Promise<void>{
    if(this.busy)throw Error('切换正在进行');if(!await this.adapter.exists(JOURNAL)){this.pending=false;return;}
    if(this.controller.credentials.busy||this.controller.credentials.creating||this.controller.session.active)throw Error('请先完成其他周记操作');
    this.busy=true;let j:Change|null=null,done=false;
    try{
      j=JSON.parse(await this.adapter.read(JOURNAL));await this.validate(j!);
      const password=j!.enabled?null:await askPassword(this.app,'继续关闭加密：验证周记密码');if(!j!.enabled&&password===null)return;
      await this.closeEditors(new Set(j!.entries.flatMap(e=>[e.source,e.target])));await this.commit(j!,password);done=true;
    }finally{this.busy=false;this.announce();}
    if(done&&j){await this.openResult(j);new Notice('周记加密切换已完成');}
  }
  private async openResult(j:Change):Promise<void>{
    const path=j.entries[0]?.target;if(!path)return;
    if(j.enabled)await this.controller.open(path);
    else{await this.controller.plugin.switchWorkspace(path.replace(/\.md$/,''));const file=this.app.vault.getAbstractFileByPath(path);if(file instanceof TFile)await this.app.workspace.getLeaf('tab').openFile(file);}
  }
  unload():void{this.guard?.unload();this.guard=null;}
}
