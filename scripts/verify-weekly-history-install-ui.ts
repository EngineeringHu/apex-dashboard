import { type App, TFile } from 'obsidian';
import { WorkspaceTemplates } from '../src/secure/templates';
import { parse } from '../src/parser';
export async function run(realApp:App,crypto:any){
 const assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
 const password='synthetic-history-install-only';
 const recipient=await crypto.call('recipient-create',{password});
 const markdown='---\ndashboard: true\ncustom: preserved\ncolumns:\n  - name: 原任务\n    type: todo\n---\n## 原任务\n### A\n- [ ] unchanged\n![[a.png]]\n';
 const ref={id:'00000000-0000-4000-8000-000000000001',key:'synthetic-key',link:'![[a.png]]',name:'a.png',mime:'image/png'};
 const before=await crypto.call('create-public',{markdown,title:'Synthetic',recipient,definitions:parse(markdown).columns,assets:[ref]});
 const path='模板/synthetic.apexenc',disk=new Map([[path,before]]),writes:string[]=[];
 const fake=(p:string)=>Object.assign(Object.create(TFile.prototype),{path:p,extension:p.split('.').pop()});
 const file=fake(path);
 const app=Object.create(realApp);
 Object.defineProperty(app,'vault',{value:{
  on:()=>null, read:async(f:TFile)=>disk.get(f.path),getAbstractFileByPath:(p:string)=>p===path?file:null,
  adapter:{exists:async(p:string)=>disk.has(p),read:async(p:string)=>disk.get(p)},
  create:async(p:string,s:string)=>{if(disk.has(p))throw Error('exists');disk.set(p,s);writes.push(p);},
 }});
 const controller:any={crypto,plugin:{app,settings:{workspaceTemplateFile:path},registerEvent:()=>{},register:()=>{}},
  mode:{assertReady:async()=>{}},credentials:{creating:0,assertReady:async()=>{}},session:{active:false},lockFile:async()=>{},
  store:{mkdir:async()=>{},enqueue:async(_p:string,fn:()=>Promise<void>)=>fn(),replace:async(p:string,old:string,next:string)=>{assert(disk.get(p)===old,'compare');disk.set(p,next);writes.push(p);}}};
 const templates=new WorkspaceTemplates(controller);
 const respond=async(value:string|null)=>{
  for(let i=0;i<60;i++){
   await Promise.resolve();
   const modal=Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='更新周计划模板：请在此输入模板密码');
   if(modal){
    if(value!==null)(modal.querySelector('input') as HTMLInputElement).value=value;
    const button=Array.from(modal.querySelectorAll('button')).find(b=>b.textContent===(value===null?'取消':'确定'))!;
    button.click();return;
   }
  }
  throw Error('synthetic password modal missing');
 };
 let operation=templates.installWeeklyHistory();await respond(null);assert(await operation===false,'cancel');
 assert(disk.get(path)===before && writes.length===0,'cancel leaves file intact');
 operation=templates.installWeeklyHistory();
 const rejected=operation.then(()=>false,()=>true);
 await respond('wrong-password');assert(await rejected,'wrong password rejects');
 assert(disk.get(path)===before && writes.length===0,'wrong password leaves file intact');
 operation=templates.installWeeklyHistory();await respond(password);assert(await operation,'installation succeeds');
 const after=disk.get(path)!;assert(after!==before,'cipher updated');
 const opened=await crypto.call('open-all',{text:after,password});
 try{
  assert(opened.markdown.includes('unchanged'),'original tasks preserved');
  assert(parse(opened.markdown).columns.some((c:any)=>c.dataviewConfig?.openSource === 'workspace'),'preset saved');
  assert(opened.payloads.flatMap((p:any)=>p.assets).some((a:any)=>a.id===ref.id&&a.key===ref.key),'assets retained');
 }finally{await crypto.call('drop',{token:opened.token});}
 assert(Array.from(disk.entries()).some(([p,s])=>p.startsWith('.apex-backups/')&&s===before),'exact encrypted backup');
 const count=writes.length;
 operation=templates.installWeeklyHistory();await respond(password);await operation;
 assert(writes.length===count,'repeat does not rewrite');
 assert(controller.credentials.creating===0,'state guard released');
 return {passed:true,checks:['cancel and wrong password preserve original','same password decrypts updated template','body and attachment keys retained','encrypted backup','repeat is idempotent'],realVaultWrites:0};
}
