import type { App } from 'obsidian';
import { renderDataviewSection } from '../src/dataview-section';
import { DataviewConfigModal } from '../src/dataview-config-modal';
import { weeklyHistoryConfig } from '../src/weekly-history-config';
import { invalidatePath } from '../src/dql/page-builder';
import { fixture } from './history-dql-fixture';
export async function run(realApp:App){
 const assert=(v:unknown,m:string)=>{if(!v)throw Error(m);};
 const tick=async()=>{for(let i=0;i<120;i++)await Promise.resolve();};
 const f=fixture();f.files.forEach(file=>invalidatePath(file.path));
 const app=Object.create(realApp);Object.defineProperty(app,'vault',{value:f.app.vault});Object.defineProperty(app,'metadataCache',{value:f.app.metadataCache});
 const host=document.createElement('div');host.className='apex-dashboard-root';host.style.position='fixed';host.style.left='-10000px';document.body.appendChild(host);
 let opened='',locked=false,refresh=()=>{};
 const context={folder:'周记',currentPath:f.current.path,templatePath:f.template.path,unavailable:()=>locked,open:async(file:any)=>{opened=file.path;}};
 const checks:string[]=[];
 const config=weeklyHistoryConfig();
 try{
  for(const viewMode of ['auto','list','table'] as const){
   host.empty();opened='';
   renderDataviewSection(host,{name:'History',color:'#123456',cards:[],sectionType:'dataview',dataviewConfig:{...config,viewMode}},app,null,null,fn=>{refresh=fn;},null,context);
   await tick();
   const labels=Array.from(host.querySelectorAll('.dashboard-dataview-task-text'));
   assert(labels.length===3,'query tasks rendered in '+viewMode);
   assert(Array.from(host.querySelectorAll<HTMLInputElement>('.dashboard-dataview-task-checkbox')).every(box=>box.disabled),'read-only in '+viewMode);
   (labels.find(el=>el.textContent==='Alpha') as HTMLElement).click();await tick();
   assert(opened===f.history.path,'source workspace callback in '+viewMode);
  }
  checks.push('standard DQL renders grouped tasks in auto/list/table; read-only and source navigation');
  f.data.set(f.history.path,f.data.get(f.history.path)!.replaceAll('- [ ]','- [x]'));invalidatePath(f.history.path);refresh();await tick();
  assert(!host.textContent?.includes('Alpha'),'refresh reflects completion');
  locked=true;const reads=f.reads();refresh();await tick();assert(reads===f.reads(),'locked query never scans');
  assert(host.textContent?.includes('关闭周记加密'),'locked hint');
  checks.push('completion refresh and encryption guard');
  let saved:any;
  const modal=new DataviewConfigModal(realApp,config,c=>{saved=c;});modal.open();
  try{
   const input=modal.contentEl.querySelector('textarea')!;assert(input.value.includes('GROUP BY'),'DQL editor visible');
   input.value='TASK WHERE completed';input.dispatchEvent(new Event('input',{bubbles:true}));
   (Array.from(modal.contentEl.querySelectorAll('.dashboard-modal-btn--confirm')).at(-1) as HTMLButtonElement).click();
   assert(saved?.query==='TASK WHERE completed'&&saved.openSource==='workspace','custom query saved with behavior: '+JSON.stringify(saved));
  }finally{modal.close();}
  checks.push('editable query modal saves actual DQL and reusable behavior settings');
  return {passed:true,checks,vaultWrites:f.writes()};
 }finally{host.remove();}
}
