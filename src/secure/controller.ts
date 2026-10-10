import { Notice, SuggestModal, TFile, type App } from 'obsidian';
import { parse } from '../parser';
import type DashboardPlugin from '../main';
import { CryptoWorker, ProtectedStore, PROTECTED_ROOT, TEMP_ROOT, report, type AssetRef } from './runtime';
import { ProtectedView, SECURE_VIEW } from './board-view';
import { PlaintextSession } from './session';
import { askPassword, askText } from './dialogs';
import { recordDiagnostic } from './diagnostics';
import { WeeklyCredentials } from './credentials';
import { WeeklyEncryptionMode } from './mode';
import { WorkspaceTemplates, type TemplateSnapshot } from './templates';

export class SecureController {
  readonly crypto:CryptoWorker;
  readonly store:ProtectedStore;
  readonly session:PlaintextSession;
  readonly credentials:WeeklyCredentials;
  readonly mode:WeeklyEncryptionMode;
  readonly templates:WorkspaceTemplates;
  private statusEl:HTMLElement;
  private lastActivity=Date.now();
  private lockQueue=Promise.resolve();
  constructor(readonly plugin:DashboardPlugin){
    this.crypto=new CryptoWorker(plugin.app,plugin.manifest.dir!);this.store=new ProtectedStore(plugin.app,this.crypto);
    this.session=new PlaintextSession(this);this.credentials=new WeeklyCredentials(this);this.mode=new WeeklyEncryptionMode(this);this.templates=new WorkspaceTemplates(this);this.statusEl=plugin.addStatusBarItem();this.status('周记保护：就绪');
    this.statusEl.onclick=()=>void(this.session.active?this.session.finish():this.pick()).catch(report);
  }
  register():void{
    const p=this.plugin;
    p.registerView(SECURE_VIEW,leaf=>new ProtectedView(leaf,this));p.registerExtensions(['apexenc'],SECURE_VIEW);
    const command=(id:string,name:string,run:()=>Promise<unknown>)=>p.addCommand({id:'protected-'+id,name:'周记加密：'+name,callback:()=>void run().catch(report)});
    command('open','打开周记（跟随加密开关）',()=>this.pick());
    command('new','新建周记（跟随加密开关）',()=>this.create());
    command('password','设置或更改统一周记密码',()=>this.credentials.setup());
    command('restore-names','恢复旧周记的明文文件名',()=>this.credentials.restoreNames());
    command('recover-password','恢复统一密码更新',()=>this.credentials.recover());
    command('lock-template','锁定加密看板模板',async()=>{this.templates.clear();new Notice('加密模板已锁定，下次新建时需要重新解锁');});
    command('lock-all','锁定已展开的周记分区',()=>this.lockAll());
    command('resume-mode','继续未完成的加密开关切换',()=>this.mode.resume());
    p.addRibbonIcon('lock-keyhole','加密周记',()=>void this.pick().catch(report));
    p.registerDomEvent(document,'keydown',()=>this.lastActivity=Date.now());
    p.registerDomEvent(document,'pointerdown',()=>this.lastActivity=Date.now());
    p.registerEvent(p.app.vault.on('modify',file=>{if(file instanceof TFile)this.session.changed(file);}));
    p.registerDomEvent(document,'visibilitychange',()=>{if(document.hidden)void this.lockEverything().catch(report);});
    p.registerInterval(window.setInterval(()=>{if(Date.now()-this.lastActivity>5*60*1000)void this.lockEverything().catch(report);},15000));
    p.app.workspace.onLayoutReady(()=>void(async()=>{await this.session.recover();if(this.session.active)command('recover-legacy','完成旧版遗留数据恢复',()=>this.session.finish());await this.credentials.recover();this.mode.announce();})().catch(report));
    p.register(()=>{this.session.unload();this.mode.unload();this.crypto.stop();});
  }
  status(message:string):void{this.statusEl.setText(message);}
  files():TFile[]{return this.plugin.app.vault.getFiles().filter(f=>f.extension==='apexenc'&&f.parent?.path===PROTECTED_ROOT);}
  workspaceFiles():TFile[]{return this.files().filter(file=>!this.templates.isTemplate(file));}
  async open(path:string):Promise<void>{
    await this.credentials.assertReady();
    if(this.session.active)throw Error('临时明文模式尚未结束，请先结束并锁定');
    const file=this.plugin.app.vault.getAbstractFileByPath(path);if(!(file instanceof TFile))throw Error('文件不存在');
    const leaf=this.plugin.app.workspace.getLeaf('tab');await leaf.openFile(file);
  }
  async pick():Promise<void>{
    await this.mode.assertReady();
    if(!this.mode.enabled){const files=this.mode.plainFiles();if(!files.length){await this.create();return;}const self=this;class PlainPicker extends SuggestModal<TFile>{getSuggestions(q:string):TFile[]{return files.filter(f=>f.basename.includes(q));}renderSuggestion(f:TFile,el:HTMLElement):void{el.setText(f.basename);}onChooseSuggestion(f:TFile):void{void self.plugin.app.workspace.getLeaf('tab').openFile(f);}}new PlainPicker(this.plugin.app).open();return;}
    if(!this.workspaceFiles().length){new Notice('请先从命令面板执行“周记加密：新建周记（跟随加密开关）”');return;}
    const self=this;
    class Picker extends SuggestModal<TFile>{getSuggestions(query:string):TFile[]{return self.workspaceFiles().filter(f=>f.basename.includes(query));}renderSuggestion(file:TFile,el:HTMLElement):void{el.setText('🔒 '+file.basename);}onChooseSuggestion(file:TFile):void{void self.open(file.path).catch(report);}}
    new Picker(this.plugin.app).open();
  }
  private views(path?:string):ProtectedView[]{return this.plugin.app.workspace.getLeavesOfType(SECURE_VIEW).map(l=>l.view).filter((v):v is ProtectedView=>v instanceof ProtectedView&&(!path||v.file?.path===path));}
  private serial(run:()=>Promise<void>):Promise<void>{const result=this.lockQueue.catch(()=>{}).then(run);this.lockQueue=result;return result;}
  lockFile(path:string):Promise<void>{return this.serial(async()=>{for(const view of this.views(path))await view.lockLocal();});}
  lockBlock(path:string,blockId:string):Promise<void>{return this.serial(async()=>{for(const view of this.views(path))await view.lockSection(blockId);});}
  lockAll():Promise<void>{return this.serial(async()=>{for(const view of this.views())await view.lockLocal();if(!this.session.active)this.crypto.stop();this.status(this.mode.enabled?'周记已锁定':'周记加密：关闭 · 普通 Markdown');});}
  async prepareSection(path:string):Promise<void>{if(this.views(path).some(v=>v.isWholeEditing()))await this.lockFile(path);}
  private async lockEverything():Promise<void>{if(this.mode.busy||this.credentials.busy)return;if(this.session.active)await this.session.finish();else if(this.mode.enabled)await this.lockAll();}
  async create(initialTitle?:string):Promise<void>{
    await this.mode.assertReady();
    if(!this.mode.enabled){const title=initialTitle||await askText(this.plugin.app,'新建周记名称','新的周计划');if(title)await this.plugin.createWorkspace(title);return;}
    if(this.session.active)throw Error('请先结束临时明文模式');
    const title=initialTitle||await askText(this.plugin.app,'新建加密周记名称','新的周计划');if(!title)return;
    const template=await this.templates.read();if(!template)return;
    await this.mode.assertReady();if(!this.mode.enabled)throw Error('加密开关已变化，请重新新建');
    await this.encryptCopy(template.markdown,title,template.path,false,template);
  }
  async importCurrent():Promise<void>{
    if(this.session.active)throw Error('请先结束临时明文模式');
    const file=this.plugin.app.workspace.getActiveFile();
    if(!file||file.extension!=='md'||!file.path.startsWith(PROTECTED_ROOT+'/')||file.path.startsWith(TEMP_ROOT+'/'))throw Error('请先打开周记目录中的原始 Markdown');
    await this.encryptCopy(await this.plugin.app.vault.read(file),file.basename,file.path,true);
  }
  async encryptCopy(markdown:string,title:string,source:string,keepSource:boolean,template?:TemplateSnapshot):Promise<void>{
    await this.credentials.assertReady();
    let recipient=await this.credentials.get();
    if(!recipient){await this.credentials.setup();recipient=await this.credentials.get();if(!recipient)return;}
    await this.credentials.assertReady();this.credentials.creating++;
    this.status('正在创建加密周记…');
    let stage='读取已有加密配置',published=false;let prepared:{refs:AssetRef[];rollback:()=>Promise<void>}|null=null;
    try{
      stage='读取附件';if(template?.encrypted)prepared=await this.templates.encryptedAssets(template);
      const refs=prepared?.refs??await this.importAssets(markdown,source);
      stage='解析模板';
      const definitions=parse(markdown).columns.map(({cards,tableContent,...definition})=>definition);
      stage='后台加密';
      // Worker verifies round-trip with a fresh per-note key, then drops it.
      const text=await this.crypto.call<string>('create-public',{markdown,title,recipient,definitions,assets:refs});
      await this.credentials.assertReady();if(JSON.stringify(await this.credentials.get())!==JSON.stringify(recipient))throw Error('统一密码刚刚更新，请重新新建');
      stage='写入加密文件';if(template?.encrypted)await this.templates.assertCurrent(template);const path=await this.store.create(text,title);published=true;stage='打开加密视图';await this.open(path);this.status('周记已锁定');
      if(keepSource)new Notice('加密副本已创建并校验。原 Markdown 和原附件仍保留，尚未完成正式迁移。',15000);
    }catch(error){if(!published&&prepared)await prepared.rollback();this.status('创建未完成：'+stage);await recordDiagnostic(this.plugin.app,'create:'+stage,error);throw Error(stage+'失败：'+(error instanceof Error?error.message:'请查看本地诊断日志'));}
    finally{this.credentials.creating--;}
  }
  async importAssets(markdown:string,source:string):Promise<AssetRef[]>{
    const refs:AssetRef[]=[];
    const matches=[...markdown.matchAll(/!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\(([^)]+)\)/g)];
    for(const match of matches){
      const target=(match[1]??match[2]??'').split('|')[0]!.split('#')[0]!.trim().replace(/^<|>$/g,'');
      if(/^(https?:|data:|file:)/i.test(target)){if(match[0].startsWith('!'))throw Error('请先将远程图片下载为库内附件，再进行加密');continue;}
      const file=this.plugin.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(target),source);
      if(!(file instanceof TFile)){if(match[0].startsWith('!')||/\.[a-z0-9]{1,10}$/i.test(target))throw Error('存在未找到的附件，请修正后加密');continue;}
      if(file.extension==='md'){if(match[0].startsWith('!'))throw Error('嵌入其他 Markdown 需先展开为正文，避免留下未加密引用');continue;}
      const mime:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',pdf:'application/pdf'};
      refs.push(await this.store.putAsset(new Uint8Array(await this.plugin.app.vault.readBinary(file)),file.name,match[0],mime[file.extension]??'application/octet-stream'));
    }
    return refs;
  }
}
