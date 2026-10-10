import { Notice, TFile, TFolder } from 'obsidian';
import { generateEmptyWeeklyMarkdown } from '../parser';
import { normalizeTemplatePath, workspaceTemplateCandidates } from '../workspace-registry';
import { askPassword } from './dialogs';
import { PROTECTED_ROOT, freshId, safeName, type AssetRef, type Payload } from './runtime';
import type { SecureController } from './controller';

export type TemplateSnapshot={markdown:string;path:string;encrypted:boolean;refs:AssetRef[];cipher?:string};
type PreparedAssets={refs:AssetRef[];rollback:()=>Promise<void>};
type PlainTemplate={markdown:string;rollback:()=>Promise<void>};

/** Only this template's plaintext and attachment keys are cached; never a password/private key.
 * Cache lifetime is the current plugin session, until explicit lock or template changes. */
export class WorkspaceTemplates{
 private cached:TemplateSnapshot|null=null;
 private pending:Promise<TemplateSnapshot|null>|null=null;
 private epoch=0;
 constructor(private controller:SecureController){
  const p=controller.plugin;
  p.registerEvent(p.app.vault.on('modify',file=>{if(file.path===this.cached?.path)this.clear();}));
  p.registerEvent(p.app.vault.on('delete',file=>{if(file.path===this.cached?.path)this.clear();}));
  p.registerEvent(p.app.vault.on('rename',(file,oldPath)=>{if(oldPath===this.cached?.path||file.path===this.cached?.path)this.clear();}));
  p.register(()=>this.clear());
 }
 private get app(){return this.controller.plugin.app;}
 file():TFile|null{
  for(const path of workspaceTemplateCandidates(this.controller.plugin.settings.workspaceTemplateFile)){
   const file=this.app.vault.getAbstractFileByPath(path);
   if(file instanceof TFile&&['md','apexenc'].includes(file.extension.toLowerCase()))return file;
  }
  return null;
 }
 isTemplate(file:TFile):boolean{return this.file()?.path===file.path;}
 clear():void{this.epoch++;this.cached=null;this.pending=null;}
 read():Promise<TemplateSnapshot|null>{
  if(this.pending)return this.pending;
  const operation=this.load();this.pending=operation;
  void operation.finally(()=>{if(this.pending===operation)this.pending=null;}).catch(()=>{});
  return operation;
 }
 private async load():Promise<TemplateSnapshot|null>{
  const selected=normalizeTemplatePath(this.controller.plugin.settings.workspaceTemplateFile),file=this.file(),epoch=this.epoch;
  if(!file){
   this.cached=null;
   if(/\.apexenc$/i.test(selected))throw Error('未找到加密模板：'+selected);
   if(selected)new Notice('未找到模板文件，已使用内置空白模板：'+selected);
   return {markdown:generateEmptyWeeklyMarkdown(),path:'',encrypted:false,refs:[]};
  }
  const raw=await this.app.vault.read(file);
  if(file.extension.toLowerCase()==='md')return {markdown:raw,path:file.path,encrypted:false,refs:[]};
  if(this.cached?.path===file.path&&this.cached.cipher===raw)return this.cached;
  this.cached=null;
  let password=await askPassword(this.app,'解锁加密看板模板（本次会话有效）');
  if(password===null)return null;
  let opened:{markdown:string;payloads:Payload[];token:string}|null=null;
  try{
   opened=await this.controller.crypto.call('open-all',{text:raw,password});
   password='';
   const refs=[...new Map(opened!.payloads.flatMap(p=>p.assets).map(ref=>[ref.id+'\n'+ref.link,ref])).values()];
   const result:TemplateSnapshot={markdown:opened!.markdown,path:file.path,encrypted:true,refs,cipher:raw};
   // Authenticate attachments before caching or creating any new note.
   for(const ref of [...new Map(refs.map(r=>[r.id,r])).values()])await this.assetBytes(result,ref);
   if(epoch!==this.epoch||selected!==normalizeTemplatePath(this.controller.plugin.settings.workspaceTemplateFile)||await this.app.vault.read(file)!==raw)throw Error('模板已更改或已锁定，请重新新建');
   this.cached=result;return result;
  }finally{
   password='';
   if(opened)await this.controller.crypto.call('drop',{token:opened.token}).catch(()=>{});
  }
 }
 private async assetBytes(template:TemplateSnapshot,ref:AssetRef):Promise<Uint8Array>{
  if(!/^[a-f0-9-]{36}$/.test(ref.id))throw Error('模板附件 ID 无效');
  const parent=template.path.includes('/')?template.path.slice(0,template.path.lastIndexOf('/')):'';
  const local=(parent?parent+'/':'')+'_assets/'+ref.id+'.apexasset';
  const fallback=PROTECTED_ROOT+'/_assets/'+ref.id+'.apexasset';
  const path=await this.app.vault.adapter.exists(local)?local:fallback;
  if(!await this.app.vault.adapter.exists(path))throw Error('缺少加密模板附件：'+ref.name);
  const asset=JSON.parse(await this.app.vault.adapter.read(path));
  return this.controller.crypto.call('asset-decrypt',{asset,ref});
 }
 async assertCurrent(template:TemplateSnapshot):Promise<void>{
  if(template.encrypted&&(this.cached!==template||!this.file()||this.file()!.path!==template.path||await this.app.vault.adapter.read(template.path)!==template.cipher))throw Error('加密模板已变化，请重新新建');
 }
 async encryptedAssets(template:TemplateSnapshot):Promise<PreparedAssets>{
  const created:string[]=[],map=new Map<string,AssetRef>(),refs:AssetRef[]=[];
  const rollback=async()=>{for(const path of created){const file=this.app.vault.getAbstractFileByPath(path);if(file instanceof TFile)await this.app.vault.delete(file);}};
  try{
   for(const ref of template.refs){
    let next=map.get(ref.id);
    if(!next){
     next=await this.controller.store.putAsset(await this.assetBytes(template,ref),ref.name,ref.link,ref.mime);
     map.set(ref.id,next);created.push(PROTECTED_ROOT+'/_assets/'+next.id+'.apexasset');
    }
    refs.push({...next,link:ref.link});
   }
   await this.assertCurrent(template);
   return {refs,rollback};
  }catch(error){await rollback();throw error;}
 }
 async plain(template:TemplateSnapshot,folder:string):Promise<PlainTemplate>{
  if(!template.encrypted||!template.refs.length)return {markdown:template.markdown,rollback:async()=>{}};
  const directory=folder+'/_附件/模板-'+freshId(),files:string[]=[],paths=new Map<string,string>();
  const rollback=async()=>{
   for(const path of files){const file=this.app.vault.getAbstractFileByPath(path);if(file instanceof TFile)await this.app.vault.delete(file);}
   const dir=this.app.vault.getAbstractFileByPath(directory);if(dir instanceof TFolder&&!dir.children.length)await this.app.vault.delete(dir,true);
  };
  try{
   await this.controller.store.mkdir(directory);let markdown=template.markdown;
   for(const ref of template.refs){
    let path=paths.get(ref.id);
    if(!path){
     path=directory+'/'+ref.id+'-'+safeName(ref.name);
     const bytes=await this.assetBytes(template,ref);
     await this.app.vault.createBinary(path,Uint8Array.from(bytes).buffer);
     paths.set(ref.id,path);files.push(path);
    }
    let link:string;
    if(/^!?\[\[/.test(ref.link))link=ref.link.replace(/^(!?\[\[)[^|#\]]+/,(_all,start:string)=>start+path);
    else{
     const start=ref.link.indexOf('](')+2,title=ref.link.slice(start,-1).match(/\s+(?:"[^"]*"|'[^']*')\s*$/)?.[0]??'';
     link=ref.link.slice(0,start)+'<'+path+'>'+title+')';
    }
    markdown=markdown.split(ref.link).join(link);
   }
   await this.assertCurrent(template);
   return {markdown,rollback};
  }catch(error){await rollback();throw error;}
 }
}
