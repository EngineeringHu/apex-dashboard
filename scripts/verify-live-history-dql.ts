import { parse } from '../src/parser';
import { buildPages,invalidatePath } from '../src/dql/page-builder';
import { executeDql } from '../src/dql';
import { WEEKLY_HISTORY_QUERY } from '../src/weekly-history-config';
export async function run(app:any,plugin:any,backup:string){
 const journal=JSON.parse(await app.vault.adapter.read(backup+'/migration.json'));
 if(journal.status!=='complete')throw Error('迁移日志未完成');
 const mappings=journal.entries as Array<{source:string;target:string;week:string}>;
 const normalizeLinks=(text:string)=>{
  for(const item of mappings)text=text.split(item.target.replace(/\.md$/,'')).join(item.source.replace(/\.md$/,'')).split(item.target.split('/').pop()!.replace(/\.md$/,'')).join(item.source.split('/').pop()!.replace(/\.md$/,''));
  return text;
 };
 for(const item of mappings){
  if(app.vault.getAbstractFileByPath(item.source))throw Error('旧路径仍存在');
  const file=app.vault.getAbstractFileByPath(item.target);if(!file)throw Error('缺少新路径');
  const before=await app.vault.adapter.read(backup+'/notes/'+item.source),after=await app.vault.read(file);
  const strip=(s:string)=>s.replace(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'');
  if(normalizeLinks(strip(after))!==strip(before))throw Error('正文出现意外变化：'+item.target);
  if(parse(after).weekStart!==item.week)throw Error('周日期错误');
  invalidatePath(file.path);
 }
 const paths=plugin.settings.workspaceFiles as string[];
 if(paths.some(path=>/^周记\/第\d+周-/.test(path)))throw Error('工作台配置仍有旧路径');
 const pages=await buildPages(app,{excludePaths:[plugin.secure.templates.file()?.path??''],excludeFolders:['周记/_临时解密']});
 const current=pages.find(p=>p.file.path===plugin.settings.dashboardFile+'.md');
 if(!current)throw Error('当前工作台索引不存在');
 const config=parse(await app.vault.read(current.file)).columns.find(c=>c.dataviewConfig?.openSource==='workspace')?.dataviewConfig;
 if(!config?.query || config.weeklyHistory)throw Error('当前工作台未使用标准 DQL');
 const result=executeDql(config.query,pages,{currentPage:current,deduplicateLinkedTasks:config.deduplicateLinkedTasks});
 if(!result.ok||result.empty)throw Error('DQL 运行失败');
 return {passed:true,bodyPreserved:mappings.length,active:plugin.settings.dashboardFile,query:config.query,
  groups:result.result.rows.map(row=>({path:row.page?.file.path,tasks:row.rows?.length??1})),
  config:{readonly:config.readOnlyTasks,deduplicate:config.deduplicateLinkedTasks,openSource:config.openSource},
  defaultQuery:config.query===WEEKLY_HISTORY_QUERY};
}
