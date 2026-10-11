import { parseDocument } from 'yaml';
import { weeklyHistoryConfig } from './weekly-history-config';
import { parse } from './parser';
import { buildMergedTableGrid, parseTableSectionRows, legacyTableTasks, tableCardId } from './table-model';
import type { TaskItem } from './types';

export const HISTORY_TITLE = '历史未完成计划';
export function dateKey(date: Date): string {
 return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}
function validDate(value: unknown): string | undefined {
 if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
 const d = new Date(value+'T12:00:00');
 return Number.isFinite(d.getTime()) && dateKey(d)===value ? value : undefined;
}
export function currentWeek(now = new Date()): string {
 const date = new Date(now); date.setDate(date.getDate()-date.getDay()); return dateKey(date);
}
/** Legacy names lack a year: use the closest valid date to creation time, never mtime. */
export function resolveWeek(markdown: string, basename: string, ctime: number): {date?: string; inferred: boolean} {
 const explicit = parse(markdown).weekStart;
 if(explicit) return {date:validDate(explicit), inferred:false};
 const full = basename.match(/(\d{4}-\d{2}-\d{2})/);
 if(full) return {date:validDate(full[1]), inferred:false};
 const named = basename.match(/^(\d{4})年第\d+周-(\d{1,2})月(\d{1,2})号(?:-\d+)?$/);
 if(named)return {date:validDate(named[1]+'-'+named[2]!.padStart(2,'0')+'-'+named[3]!.padStart(2,'0')),inferred:false};
 const old = basename.match(/^第\d+周-(\d{1,2})月(\d{1,2})号(?:-\d+)?$/);
 if(!old || !Number.isFinite(ctime) || ctime<=0) return {inferred:false};
 const year = new Date(ctime).getFullYear();
 const candidates = [year-1,year,year+1].map(y=>validDate(y+'-'+old[1]!.padStart(2,'0')+'-'+old[2]!.padStart(2,'0')))
  .filter((v):v is string=>!!v).sort((a,b)=>Math.abs(+new Date(a+'T12:00:00')-ctime)-Math.abs(+new Date(b+'T12:00:00')-ctime));
 return {date:candidates[0], inferred:true};
}
function editFrontmatter(markdown:string, edit:(doc:ReturnType<typeof parseDocument>)=>void):string {
 const match = markdown.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
 if(!match) throw Error('看板缺少 YAML 配置，未修改文件');
 const doc=parseDocument(match[1]!);
 if(doc.errors.length) throw Error('看板 YAML 配置无效，未修改文件');
 edit(doc);
 return '---\n'+doc.toString()+'---\n'+markdown.slice(match[0].length);
}
export function stampWeeklyDate(markdown:string, name:string, now=new Date()):string {
 const date=resolveWeek('',name,now.getTime()).date ?? currentWeek(now);
 return editFrontmatter(markdown,doc=>doc.set('weekStart',date));
}
/** Add only the configuration and heading; preserve the existing note body. */
export function addWeeklyHistory(markdown:string):string {
 const legacy=/weeklyHistory:\s*true/.test(markdown);
 if(legacy) return editFrontmatter(markdown,doc=>{
  const columns=doc.toJS()?.columns;
  if(!Array.isArray(columns))throw Error('看板分区配置无效');
  for(const column of columns)if(column.dataview?.weeklyHistory){
   const {weeklyHistory,...config}=column.dataview;
   column.dataview={...config,...weeklyHistoryConfig(),query:config.query?.trim()||weeklyHistoryConfig().query};
  }
  doc.set('columns',columns);
 });
 if(parse(markdown).columns.some(c=>c.dataviewConfig?.openSource==='workspace' && c.dataviewConfig?.deduplicateLinkedTasks)) return markdown;
 let title=HISTORY_TITLE;
 const names=new Set(parse(markdown).columns.map(c=>c.name));
 for(let i=2;names.has(title);i++) title=HISTORY_TITLE+' '+i;
 const next=editFrontmatter(markdown,doc=>{
  const columns=doc.toJS()?.columns ?? [];
  if(!Array.isArray(columns)) throw Error('看板分区配置无效');
  columns.push({name:title,color:'#6366f1',type:'dataview',dataview:weeklyHistoryConfig()});
  doc.set('columns',columns);
 });
 return next.trimEnd()+'\n\n## '+title+'\n';
}
export interface HistoryTask {text:string; section:string; card:string; copies:number}
export interface HistoryNote {path:string; name:string; date:string; inferred:boolean; tasks:HistoryTask[]}
export function unfinishedTasks(markdown:string):HistoryTask[] {
 const out:HistoryTask[]=[];
 for(const [sectionIndex,col] of parse(markdown).columns.entries()){
  const seen=new Map<string,HistoryTask>();
  const visit=(tasks:TaskItem[],card:string):void=>{
   for(const task of tasks){
    if(!task.checked){
     const key=task.syncId ? sectionIndex+':'+task.syncId : undefined;
     const old=key ? seen.get(key) : undefined;
     if(old) old.copies++;
     else{
      const row={text:task.text,section:col.name,card,copies:1};
      out.push(row); if(key) seen.set(key,row);
     }
    }
    visit(task.children??[],card);
   }
  };
  for(const card of col.cards) visit(card.tasks??[],card.title);
  if(col.sectionType==='table'){
   const grid=buildMergedTableGrid(parseTableSectionRows(col.tableContent??''));
   for(const row of grid.slice(1)) for(const cell of row) {
    if(!cell || tableCardId(cell.text)) continue;
    const checkedLines=cell.text.split(/<br\s*\/?>/i).filter(line=>/^\s*(?:-\s*)?\[[ xX]\]/.test(line));
    visit(legacyTableTasks(checkedLines.join('<br>')),'表格任务');
   }
  }
 }
 return out;
}
export function historyCutoff(currentMarkdown:string,currentName:string,currentCtime:number,now=new Date()):string{
 const current=resolveWeek(currentMarkdown,currentName,currentCtime).date;
 const today=currentWeek(now);
 return current && current<today ? current : today;
}
