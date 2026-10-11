import { parseDocument } from 'yaml';
import { addWeeklyHistory, resolveWeek } from '../src/weekly-history';
import { parse } from '../src/parser';

export function prepareWeeklyNote(markdown:string,basename:string,ctime:number){
 const week=resolveWeek(markdown,basename,ctime).date;
 if(!week)throw Error('无法确认周记年份：'+basename);
 const fm=markdown.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
 if(!fm)throw Error('周记缺少配置：'+basename);
 const doc=parseDocument(fm[1]!);if(doc.errors.length)throw Error('周记配置无效：'+basename);
 doc.set('weekStart',week);
 let next='---\n'+doc.toString()+'---\n'+markdown.slice(fm[0].length);
 if((doc.toJS()?.columns??[]).some((c:any)=>c.dataview?.weeklyHistory))next=addWeeklyHistory(next);
 const name=/^第\d+周-\d{1,2}月\d{1,2}号(?:-\d+)?$/.test(basename) ? week.slice(0,4)+'年'+basename : basename;
 return {name,week,markdown:next};
}

export async function run(app:any,plugin:any){
 await plugin.secure.mode.assertReady();await plugin.secure.credentials.assertReady();
 if(plugin.secure.mode.enabled||plugin.secure.session.active)throw Error('迁移需要关闭周记加密并完成转换');
 if(plugin.secure.credentials.creating)throw Error('请先完成模板或周记操作');
 const leaves:any[]=[];app.workspace.iterateAllLeaves((leaf:any)=>leaves.push(leaf));
 if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
 for(const leaf of leaves){await leaf.view.sync?.flushPending?.();if(leaf.view.getViewType?.()==='markdown')await leaf.view.save?.();}
 const folder=plugin.workspaceFolder();
 const files=app.vault.getMarkdownFiles().filter((f:any)=>f.parent?.path===folder && f.path!==plugin.secure.templates.file()?.path);
 const plan:any[]=[];
 for(const file of files){
  const before=await app.vault.read(file);
  if(!/^第\d+周-/.test(file.basename)&&!/^\d{4}年第\d+周-/.test(file.basename))continue;
  const next=prepareWeeklyNote(before,file.basename,file.stat.ctime),target=folder+'/'+next.name+'.md';
  if(target!==file.path&&app.vault.getAbstractFileByPath(target))throw Error('目标文件已存在：'+target);
  if(next.markdown!==before||target!==file.path)plan.push({source:file.path,target,week:next.week,before,after:next.markdown,file});
 }
 const uuid=crypto.randomUUID(),backup='.apex-backups/weekly-dql-'+uuid;
 const snapshots=new Map<string,string>();
 for(const file of app.vault.getMarkdownFiles().filter((f:any)=>!f.path.startsWith('.')))snapshots.set(file.path,await app.vault.read(file));
 const originalSettings={workspaceFiles:[...plugin.settings.workspaceFiles],workspaceNames:[...plugin.settings.workspaceNames],dashboardFile:plugin.settings.dashboardFile};
 await plugin.secure.store.mkdir(backup+'/notes');
 for(const [path,raw] of snapshots){
  const dest=backup+'/notes/'+path,dir=dest.slice(0,dest.lastIndexOf('/'));
  await plugin.secure.store.mkdir(dir);await app.vault.adapter.write(dest,raw);
  if(await app.vault.adapter.read(dest)!==raw)throw Error('备份校验失败：'+path);
 }
 const journal:any={status:'prepared',settings:originalSettings,entries:plan.map(({source,target,week})=>({source,target,week})),completed:[]};
 const save=()=>app.vault.adapter.write(backup+'/migration.json',JSON.stringify(journal,null,2));
 await save();
 const oldUpdateLinks=app.vault.getConfig('alwaysUpdateLinks');
 plugin.secure.credentials.creating++;
 try{
  app.vault.setConfig('alwaysUpdateLinks',true);
  for(const item of plan){
   await app.vault.process(item.file,(current:string)=>{if(current!==item.before)throw Error('周记已被修改：'+item.source);return item.after;});
  }
  // Upgrade all metadata first: later renames may rewrite backlinks in other planned notes.
  for(const item of plan){
   if(item.source!==item.target){
    await app.fileManager.renameFile(item.file,item.target);
    // File rename listeners queue this same idempotent operation; await their completion.
    await plugin.retargetWorkspace(item.source,item.target);
   }
   const current=await app.vault.read(item.file);
   if(parse(current).weekStart!==item.week)throw Error('日期校验失败：'+item.target);
   journal.completed.push(item.target);await save();
  }
  const pathMap=new Map(plan.map(p=>[p.source.replace(/\.md$/,''),p.target.replace(/\.md$/,'')]));
  for(const old of originalSettings.workspaceFiles){
   const target=pathMap.get(old)??old;
   if(!plugin.settings.workspaceFiles.includes(target))throw Error('工作台配置未同步：'+target);
  }
  const changedOtherFiles:string[]=[];
  for(const [path,raw] of snapshots){
   if(plan.some(p=>p.source===path))continue;
   const file=app.vault.getAbstractFileByPath(path);
   if(!file)throw Error('迁移后缺少文件：'+path);
   if(await app.vault.read(file)!==raw)changedOtherFiles.push(path);
  }
  journal.status='complete';journal.changedLinkedNotes=changedOtherFiles;await save();
  return {passed:true,backup,renamed:journal.entries,changedLinkedNotes:changedOtherFiles,active:plugin.settings.dashboardFile};
 }catch(error){journal.status='incomplete';journal.error=String(error);await save();throw error;}
 finally{app.vault.setConfig('alwaysUpdateLinks',oldUpdateLinks);plugin.secure.credentials.creating--;}
}
