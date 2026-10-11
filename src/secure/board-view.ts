import { FileView, Modal, Notice, TFile, setIcon, type WorkspaceLeaf } from 'obsidian';
import { parse, parseDashboardShell, serialize, generateEmptyWeeklyMarkdown } from '../parser';
import { DashboardView } from '../view';
import { showConfirmDialog } from '../confirm-dialog';
import type { DashboardData, DashboardColumn, RenderCallbacks } from '../types';
import type { SecureController } from './controller';
import { askPassword } from './dialogs';
import { envelope, report, type Payload, type Envelope } from './runtime';

export const SECURE_VIEW='apex-protected-view';
type OpenSection={payload:Payload;token:string;expected:string;urls:string[]};
const definition=(c:DashboardColumn)=>{const {cards,tableContent,protectedBlockId,...rest}=c;return rest;};
const prefix=(d:DashboardData)=>serialize(d).split('\n## ')[0]+'\n\n';
const rawColumn=(d:DashboardData,c:DashboardColumn)=>{const text=serialize({...d,columns:[c]}),at=text.indexOf('\n## ');if(at<0)throw Error('分区序列化失败');return text.slice(at+1);};

/** File lifecycle outside; the ordinary dashboard layout/editor inside. */
export class ProtectedView extends FileView {
  private e:Envelope|null=null;
  private board:DashboardView|null=null;
  private model:DashboardData=parse(generateEmptyWeeklyMarkdown());
  private openSections=new Map<string,OpenSection>();
  private info:Payload|null=null;
  private infoExpected='';
  private epoch=0;
  private locking=false;
  private opening=new Set<string>();
  private boardPending:Promise<void>=Promise.resolve();
  private rawModals=new Map<string,Modal>();
  private whole:{token:string;text:string;title:string;assets:any[];expected:string;editor:HTMLTextAreaElement;timer:number|null;pending:Promise<void>}|null=null;
  constructor(leaf:WorkspaceLeaf,readonly controller:SecureController){super(leaf);
    this.addAction('file-pen-line','整篇 Markdown',()=>void this.editWhole().catch(report));
    this.addAction('lock-keyhole','锁定本周',()=>void controller.lockFile(this.file?.path??'').catch(report));
  }
  getViewType():string{return SECURE_VIEW;}
  getDisplayText():string{return this.file?.basename??'加密周记';}
  getIcon():string{return 'lock-keyhole';}
  isWholeEditing():boolean{return this.whole!==null;}
  async onLoadFile(file:TFile):Promise<void>{
    this.epoch++;await this.lockLocal();await this.disposeBoard();this.e=envelope(await this.app.vault.read(file));this.info=null;
    let template=generateEmptyWeeklyMarkdown();
    // A locked note must not decrypt or display a cached encrypted template.
    const f=this.controller.templates.file();if(f?.extension.toLowerCase()==='md')template=await this.app.vault.read(f);
    const shell=parse(template);
    this.model={...shell,columns:this.e.blocks.slice(1).map((b,i)=>({...definition(shell.columns[i]??{name:b.kind==='table'?'周计划表':'分区 '+(i+1),color:'#8d6e63',sectionType:b.kind==='table'?'table':'memo',cards:[]}),cards:[],protectedBlockId:b.id}))};
    await this.mountBoard();
  }
  async onUnloadFile():Promise<void>{this.epoch++;if(this.file)await this.controller.lockFile(this.file.path);await this.lockLocal();await this.disposeBoard();this.contentEl.empty();this.e=null;this.info=null;this.model=parse('');}
  private async disposeBoard():Promise<void>{if(this.board){const b=this.board;this.board=null;await b.onClose();this.removeChild(b);b.containerEl.remove();}}
  private async mountBoard():Promise<void>{
    this.contentEl.empty();this.contentEl.addClass('apex-protected-host');
    const b=new DashboardView(this.leaf,this.controller.plugin,{path:()=>this.file?.path??'',data:()=>this.model,save:d=>this.saveBoard(d),callbacks:base=>this.callbacks(base),decorate:root=>this.decorate(root)});
    this.board=b;this.addChild(b);this.contentEl.appendChild(b.containerEl);b.containerEl.addClass('apex-protected-dashboard');await b.onOpen();
  }
  private showBoard():void{this.board?.containerEl.show();this.board?.setProtectedData(this.model);}
  private callbacks(base:RenderCallbacks):RenderCallbacks{
    const guarded={...base,getSectionLocked:(c:DashboardColumn)=>!this.openSections.has(c.protectedBlockId??''),onSectionLockToggle:(c:DashboardColumn)=>{
      const id=c.protectedBlockId;if(!id)return;void(this.openSections.has(id)?this.controller.lockBlock(this.file!.path,id):this.unlock(id)).catch(report);
    }};
    for(const key of ['onMoveCard','onTaskMoveToCard','onDocMoveToCard'] as const){const original=(base as any)[key];(guarded as any)[key]=(...args:any[])=>{
      const target=key==='onMoveCard'?this.model.columns.find(c=>c.name===args[1]):this.model.columns.find(c=>c.cards.some(card=>card.id===args[2]));
      if(!target||!this.openSections.has(target.protectedBlockId??'')){new Notice('请先展开并解锁目标分区');return;}return original(...args);
    };}
    for(const key of ['onMemoSaveAsNote','onTaskSaveToDaily','onArchiveTasks'] as const){
      const original=(base as any)[key];(guarded as any)[key]=(...args:any[])=>void(async()=>{
        if(await showConfirmDialog(this.app,{title:'导出为普通笔记',message:'此操作会把选中的内容写入普通 Markdown，不随当前分区收起而加密。继续导出？'}))await original(...args);
      })().catch(report);
    }
    return guarded;
  }
  private decorate(root:HTMLElement):void{
    root.addClass('apex-protected-board');const select=root.querySelector<HTMLSelectElement>('.dashboard-workspace-select');if(select&&this.file)select.value=this.file.path;
    for(const el of Array.from(root.querySelectorAll<HTMLElement>('.dashboard-section-row[data-secure-id]'))){
      const id=el.dataset.secureId!,s=this.openSections.get(id);if(!s||el.querySelector('.apex-protected-section-actions'))continue;
      const actions=el.querySelector<HTMLElement>('.dashboard-section-header-actions');if(!actions)continue;
      const group=actions.createSpan({cls:'apex-protected-section-actions'});
      const edit=group.createEl('button',{cls:'dashboard-section-add-btn',attr:{'aria-label':'编辑分区 Markdown'}});setIcon(edit,'file-pen-line');edit.onclick=()=>this.rawEditor(id);
      const attach=group.createEl('button',{cls:'dashboard-section-add-btn',attr:{'aria-label':'加密导入附件'}});setIcon(attach,'paperclip');attach.onclick=()=>this.attach(id);
      if(s.payload.assets.length){const assets=el.createDiv({cls:'apex-protected-assets'});for(const ref of s.payload.assets){const button=assets.createEl('button',{text:ref.name});button.onclick=()=>void(async()=>{
        const bytes=await this.controller.store.getAsset(ref);if(this.openSections.get(id)!==s)return;
        if(!/^image\/(png|jpeg|gif|webp|bmp)$/.test(ref.mime))throw Error('此附件请通过临时解密或独立脚本查看');
        const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:ref.mime}));s.urls.push(url);assets.createEl('img',{cls:'apex-protected-image',attr:{src:url,alt:ref.name}});
      })().catch(report);}}
    }
  }
  private columnFromPayload(id:string,p:Payload):DashboardColumn{
    const name=p.raw.match(/^##\s+([^\r\n]+)/)?.[1]??'分区';const def={color:'#8d6e63',...p.definition,name,cards:[]};
    const column=parse(prefix({...this.model,columns:[def]})+p.raw).columns[0];if(!column)throw Error('无法读取分区内容');return {...column,protectedBlockId:id};
  }
  private applyInfo(info:Payload,e:Envelope):void{
    this.info=info;this.infoExpected=JSON.stringify(e.blocks[0]);const shell=parseDashboardShell(info.raw);
    this.model={...shell,columns:e.blocks.slice(1).map((b,i)=>{const c=this.model.columns.find(c=>c.protectedBlockId===b.id);if(this.openSections.has(b.id)&&c)return c;
      return {...definition(shell.columns[i]??c??{name:'分区 '+(i+1),color:'#8d6e63',cards:[]}),cards:[],protectedBlockId:b.id};})};
  }
  private async unlock(id:string):Promise<void>{
    await this.controller.credentials.assertReady();
    if(this.controller.session.active)throw Error('请先结束临时明文模式');if(this.openSections.has(id)||this.opening.has(id)||this.locking)return;
    const path=this.file?.path;if(!path)return;this.opening.add(id);
    try{await this.controller.prepareSection(path);const epoch=this.epoch;const password=await askPassword(this.app,'解锁分区');if(password===null)return;
      const text=await this.controller.store.read(path),e=envelope(text),opened=await this.controller.crypto.call('unlock',{text,blockId:id,password});
      if(epoch!==this.epoch||this.controller.session.active){await this.controller.crypto.call('drop',{token:opened.token});return;}
      this.applyInfo(opened.info,e);const s={payload:opened.payload,token:opened.token,expected:JSON.stringify(e.blocks.find(b=>b.id===id)),urls:[]};
      this.openSections.set(id,s);this.e=e;this.model={...this.model,columns:this.model.columns.map(c=>c.protectedBlockId===id?this.columnFromPayload(id,s.payload):c)};this.showBoard();
    }finally{this.opening.delete(id);}
  }
  private saveBoard(data:DashboardData):Promise<void>{
    const desired=structuredClone(data),run=this.boardPending.catch(()=>{}).then(()=>this.writeBoard(desired));this.boardPending=run;
    return run.catch(error=>{new Notice('加密保存未完成：'+(error instanceof Error?error.message:'请保留当前编辑'),10000);throw error;});
  }
  private async writeBoard(data:DashboardData):Promise<void>{
    if(!this.file||!this.e)throw Error('周记已关闭');const path=this.file.path,previous=this.model;
    const layoutChanged=data.columns.map(c=>c.protectedBlockId??'new').join('|')!==previous.columns.map(c=>c.protectedBlockId).join('|'),infoChanged=prefix(data)!==prefix(previous);
    const patches:Array<{id:string;token:string;payload:Payload;expected:string}>=[];
    for(const c of data.columns){const id=c.protectedBlockId,old=previous.columns.find(c=>c.protectedBlockId===id);if(!id||!old)continue;
      if(rawColumn(data,c)===rawColumn(previous,old)&&JSON.stringify(definition(c))===JSON.stringify(definition(old)))continue;
      const s=this.openSections.get(id);if(!s)throw Error('请先解锁要编辑的分区');patches.push({id,token:s.token,expected:s.expected,payload:{...s.payload,raw:rawColumn(data,c),definition:definition(c)}});
    }
    if(!layoutChanged&&!infoChanged&&!patches.length){this.model=data;return;}
    let password:string|null=null,transient:string|null=null;
    if(layoutChanged||(!this.info&&infoChanged)||(!this.openSections.size&&infoChanged)){password=await askPassword(this.app,'验证密码以修改工作台布局');if(password===null){this.board?.setProtectedData(previous);return;}}
    try{await this.controller.store.enqueue(path,async()=>{
      const text=await this.controller.store.read(path),e=envelope(text);
      if(e.blocks.map(b=>b.id).join('|')!==this.e!.blocks.map(b=>b.id).join('|'))throw Error('分区结构已被其他窗口修改，请重新打开');
      for(const p of patches)if(JSON.stringify(e.blocks.find(b=>b.id===p.id))!==p.expected)throw Error('该分区存在外部修改，请保留当前编辑');
      let info=this.info,infoToken=this.openSections.values().next().value?.token;
      if(password!==null){const opened=await this.controller.crypto.call('unlock',{text,blockId:e.blocks[0]!.id,password});info=opened.info;infoToken=opened.token;transient=opened.token;}
      if(!info)throw Error('请先解锁一个分区');
      if((infoChanged||layoutChanged)&&this.info&&JSON.stringify(e.blocks[0])!==this.infoExpected)throw Error('工作台布局已被其他窗口修改，请重新打开');
      const infoPayload=(infoChanged||layoutChanged)?{...info,raw:prefix(data)}:undefined;
      const layout=layoutChanged?data.columns.map(c=>c.protectedBlockId?{id:c.protectedBlockId}:{payload:{raw:rawColumn(data,c),definition:definition(c),assets:[]}}):undefined;
      const next=await this.controller.crypto.call<string>('save-board',{text,patches,infoPayload,infoToken,layout,password});await this.controller.store.replace(path,text,next);this.e=envelope(next);
      for(const p of patches){const s=this.openSections.get(p.id);if(s){s.payload=p.payload;s.expected=JSON.stringify(this.e.blocks.find(b=>b.id===p.id));}}
      if(infoPayload)this.info=infoPayload;this.infoExpected=JSON.stringify(this.e.blocks[0]);data.columns.forEach((c,i)=>{c.protectedBlockId=this.e!.blocks[i+1]!.id;});
      for(const [id,s]of this.openSections)if(!this.e.blocks.some(b=>b.id===id)){await this.controller.crypto.call('drop',{token:s.token});s.urls.forEach(URL.revokeObjectURL);this.openSections.delete(id);}
      this.model=data;
    });
    const live=(this.board as any)?.sync?.getData() as DashboardData|undefined;if(live&&layoutChanged)live.columns.forEach((c,i)=>{c.protectedBlockId=data.columns[i]?.protectedBlockId;});
    }finally{if(transient)await this.controller.crypto.call('drop',{token:transient});password=null;}
  }
  private rawEditor(id:string):void{
    const s=this.openSections.get(id);if(!s)return;const self=this;
    class Editor extends Modal{editor!:HTMLTextAreaElement;
      onOpen(){this.titleEl.setText('编辑分区 Markdown');this.editor=this.contentEl.createEl('textarea',{cls:'apex-protected-editor'});this.editor.value=s!.payload.raw;
        this.contentEl.createEl('button',{text:'保存',cls:'mod-cta'}).onclick=()=>void(async()=>{if(self.openSections.get(id)!==s)throw Error('该分区已锁定');await self.saveExactRaw(id,this.editor.value);self.showBoard();this.close();})().catch(report);}
      onClose(){this.editor.value='';this.contentEl.empty();self.rawModals.delete(id);}
    }const modal=new Editor(this.app);this.rawModals.set(id,modal);modal.open();
  }
  private async saveExactRaw(id:string,raw:string):Promise<void>{
    const s=this.openSections.get(id);if(!s||!this.file)throw Error('该分区已锁定');
    const c=this.columnFromPayload(id,{...s.payload,raw});
    await this.saveBoard({...this.model,columns:this.model.columns.map(x=>x.protectedBlockId===id?c:x)});
    const path=this.file.path;
    const pending=this.boardPending.catch(()=>{}).then(async()=>{
      if(this.openSections.get(id)!==s)throw Error('该分区已锁定');
      const payload={...s.payload,raw};s.expected=await this.controller.store.saveBlock(path,id,s.expected,s.token,payload);s.payload=payload;
      this.e=envelope(await this.controller.store.read(path));
    });this.boardPending=pending;await pending;
  }
  private attach(id:string):void{
    const s=this.openSections.get(id);if(!s)return;const input=document.createElement('input');input.type='file';input.onchange=()=>void(async()=>{
      const f=input.files?.[0];if(!f)return;const link='![['+f.name+']]',ref=await this.controller.store.putAsset(new Uint8Array(await f.arrayBuffer()),f.name,link,f.type);
      if(this.openSections.get(id)!==s)return;s.payload.assets.push(ref);await this.saveExactRaw(id,s.payload.raw+'\n'+link+'\n');this.showBoard();
    })().catch(report);input.click();
  }
  async lockSection(id:string):Promise<void>{
    const s=this.openSections.get(id);if(!s)return;(this.contentEl.doc.activeElement as HTMLElement|null)?.blur();this.rawModals.get(id)?.close();this.board?.closeProtectedEditors();
    await this.board?.flushProtected();await this.boardPending;await this.controller.crypto.call('drop',{token:s.token});s.urls.forEach(URL.revokeObjectURL);s.payload.raw='';s.payload.assets=[];this.openSections.delete(id);
    this.model={...this.model,columns:this.model.columns.map(c=>c.protectedBlockId===id?{...definition(c),protectedBlockId:id,cards:[]}:c)};this.showBoard();
  }
  async lockLocal():Promise<void>{this.epoch++;this.locking=true;try{await this.saveWhole();for(const id of [...this.openSections.keys()])await this.lockSection(id);}finally{this.locking=false;}}
  private async editWhole():Promise<void>{
    await this.controller.credentials.assertReady();
    if(this.controller.session.active)throw Error('请先结束临时明文模式');const path=this.file?.path;if(!path)return;await this.controller.lockFile(path);const epoch=this.epoch;
    const password=await askPassword(this.app,'打开整篇 Markdown');if(password===null)return;const text=await this.controller.store.read(path),all=await this.controller.crypto.call('open-all',{text,password});
    if(epoch!==this.epoch){await this.controller.crypto.call('drop',{token:all.token});return;}this.board?.containerEl.hide();const region=this.contentEl.createDiv({cls:'apex-protected-whole'});
    region.createEl('button',{text:'保存并锁定'}).onclick=()=>void this.controller.lockFile(path).catch(report);const editor=region.createEl('textarea',{cls:'apex-protected-editor'});editor.value=all.markdown;
    const w=this.whole={token:all.token,text:all.markdown,title:all.title,assets:all.payloads.flatMap((p:Payload)=>p.assets),expected:text,editor,timer:null as number|null,pending:Promise.resolve()};
    editor.oninput=()=>{if(w.timer!==null)return;w.timer=window.setTimeout(()=>{w.timer=null;void this.commitWhole(w,path).catch(report);},500);};
  }
  private commitWhole(w:NonNullable<ProtectedView['whole']>,path:string):Promise<void>{
    w.pending=w.pending.catch(()=>{}).then(async()=>{const markdown=w.editor.value;if(markdown===w.text)return;const definitions=parse(markdown).columns.map(definition);
      await this.controller.store.enqueue(path,async()=>{const next=await this.controller.crypto.call<string>('save-all',{text:w.expected,token:w.token,markdown,title:w.title,assets:w.assets,definitions});await this.controller.store.replace(path,w.expected,next);w.expected=next;w.text=markdown;});});return w.pending;
  }
  private async saveWhole():Promise<void>{
    const w=this.whole,path=this.file?.path;if(!w||!path)return;if(w.timer!==null)window.clearTimeout(w.timer);await this.commitWhole(w,path);await this.controller.crypto.call('drop',{token:w.token});w.editor.value='';this.whole=null;
    this.e=envelope(await this.controller.store.read(path));this.model=parse(w.text);this.info={raw:w.text.split(/(?=^##\s)/m)[0]!,title:w.title,assets:[]};this.infoExpected=JSON.stringify(this.e.blocks[0]);
    this.model.columns=this.model.columns.map((c,i)=>({...definition(c),cards:[],protectedBlockId:this.e!.blocks[i+1]!.id}));this.contentEl.querySelector('.apex-protected-whole')?.remove();this.showBoard();
  }
}
