import { TFile } from 'obsidian';
import { parse as parseYaml } from 'yaml';
import { dateKey, currentWeek } from '../src/weekly-history';
export function fixture(){
 const now=new Date(),old=new Date(now);old.setDate(old.getDate()-21);
 const older=new Date(now);older.setDate(older.getDate()-28);
 const data=new Map<string,string>();let writes=0,reads=0;
 const make=(name:string,week:string,body:string,folder='周记')=>{
  const file=Object.assign(Object.create(TFile.prototype),{path:folder+'/'+name+'.md',name:name+'.md',basename:name,extension:'md',parent:{path:folder},stat:{ctime:+now,mtime:+now,size:body.length}}) as TFile;
  data.set(file.path,'---\ndashboard: true\nweekStart: '+week+'\ncolumns:\n  - name: 任务\n    type: todo\n---\n## 任务\n### A\n'+body+'\n');
  return file;
 };
 const history=make('__history',dateKey(old),'- [ ] Alpha <!--apex-daily:diary.md--> <!--apex-sync:g:a-->\n- [ ] Alpha <!--apex-sync:g:b-->\n- [x] Done\n| category | - [ ] Legacy |');
 const earlier=make('__earlier',dateKey(older),'- [ ] Earlier');
 const current=make('__current',currentWeek(now),'- [ ] Current');
 const future=make('__future','2099-01-01','- [ ] Future');
 const template=make('__template',dateKey(old),'- [ ] Template');
 const temp=make('__temp',dateKey(old),'- [ ] Temp','周记/_临时解密');
 const files=[history,earlier,current,future,template,temp];
 const app:any={
  vault:{getMarkdownFiles:()=>files,cachedRead:async(f:TFile)=>{reads++;return data.get(f.path)!;},getAbstractFileByPath:(path:string)=>files.find(f=>f.path===path),
   modify:()=>{writes++;throw Error('unexpected write');}},
  metadataCache:{resolvedLinks:{},getFileCache:(f:TFile)=>({frontmatter:parseYaml(data.get(f.path)!.split('---')[1]!)}),getFirstLinkpathDest:(path:string)=>files.find(f=>f.path===path)},
 };
 return {app,files,history,earlier,current,future,template,data,reads:()=>reads,writes:()=>writes};
}

/** Every status/type combination, including a cancelled legacy table cell. */
export function taskFilterFixture() {
 const f=fixture();
 const lines=['pending','deferred','cancelled','completed'].flatMap(status=>['planned','temporary'].map(type=>
  `- [${status==='completed'?'x':status==='cancelled'?'-':' '}] ${status}-${type} <!--apex-task-type:${type}-->${status==='deferred'?' <!--apex-task-status:deferred-->':''}`));
 f.data.set(f.history.path,f.data.get(f.history.path)+'\n'+lines.join('\n')+'\n| old | - [-] Legacy cancelled <!--apex-task-type:temporary--> |\n');
 return f;
}
