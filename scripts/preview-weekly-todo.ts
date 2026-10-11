import { App, Modal, Notice } from 'obsidian';
import { renderTableSection } from '../src/renderer';
import { SyncEngine } from '../src/sync';
import { parse, generateEmptyWeeklyMarkdown } from '../src/parser';
import { insertTableTodo } from '../src/table-model';
import { DEFAULT_SETTINGS, type RenderCallbacks } from '../src/types';

export function showPreview(realApp: App) {
 class Preview extends Modal {
  private engine!: SyncEngine;
  onOpen() {
   this.titleEl.setText('新版周计划 · 待办卡片预览');
   this.modalEl.style.width = 'min(1400px, 95vw)';
   this.modalEl.style.maxWidth = '95vw';
   this.contentEl.createEl('p', { text: '试着将任务拖到另一格，或点击链接图标关联已有日记。此处为临时预览，任务改动不会保存。' });
   const liveRoot = document.querySelector<HTMLElement>('.apex-dashboard-root');
   const host = this.contentEl.createDiv({ cls: 'apex-dashboard-root' });
   if(liveRoot) { host.dataset.theme = liveRoot.dataset.theme; host.style.cssText = liveRoot.style.cssText; }
   host.style.height = 'auto'; host.style.minHeight = '0'; host.style.padding = '12px'; host.style.overflow = 'auto';
   const data = parse(generateEmptyWeeklyMarkdown());
   let table = data.columns.find(c => c.sectionType === 'table')!;
   table.tableContent = '| 角色 | 目标 | 周一 | 周二 | 周三 |\n| --- | --- | --- | --- | --- |\n| 本周计划 |  | 每日任务 | > | > |\n| 工作 | 推进项目 | 整理需求<br>准备评审 |  |  |\n| 个人 | 学习与生活 | 阅读 30 分钟 |  |  |';
   table = insertTableTodo(table,2,2,'preview-mon','周一待办');
   table = insertTableTodo(table,2,3,'preview-tue','周二待办');
   table = insertTableTodo(table,3,2,'preview-personal','个人待办');
   data.columns = [table];
   const app = Object.create(realApp) as App;
   const rejectWrite = async () => { throw Error('临时预览只支持关联已有日记，不会创建或修改日记。'); };
   Object.defineProperty(app,'vault',{value:Object.assign(Object.create(realApp.vault), {
    create:rejectWrite,modify:rejectWrite,process:rejectWrite,
    adapter:Object.assign(Object.create(realApp.vault.adapter),{mkdir:rejectWrite}),
   })});
   this.engine = new SyncEngine(app,DEFAULT_SETTINGS);
   this.engine.initMemory(data,async()=>{});
   const e = this.engine;
   const callbacks = {
    onTaskUnlink:(id,path)=>e.unlinkTask(id,path),
    onTableTodoInsert:(name,row,col)=>e.insertTableTodo(name,row,col),
    onTaskAdd:(id,text,parent)=>e.addTask(id,text,parent),
    onTaskDelete:(id,path)=>e.deleteTask(id,path),
    onTaskEdit:(id,path,text)=>e.editTask(id,path,text),
    onCheckboxToggle:(id,path,checked)=>e.toggleTask(id,path,checked),
    onTaskMoveToCard:(source,path,dest,destPath,mode,copy)=>e.moveTaskToCard(source,path,dest,destPath,mode,copy),
    onTaskReorder:(id,from,to,before)=>e.reorderTask(id,from,to,before),
    onTaskNestInto:(id,from,to)=>e.nestTaskInto(id,from,to),
    onTaskNest:(id,path)=>e.nestTask(id,path),
    onTaskUnnest:(id,path)=>e.unnestTask(id,path),
    onTaskToggleCollapse:(id,path)=>e.toggleCollapseTaskQuiet(id,path),
    onTaskReminderEdit:(id,path,reminder)=>e.editTaskReminder(id,path,reminder),
    onTaskDailyNoteChange:(id,path,note,text)=>e.setTaskDailyNote(id,path,note,text),
    onCardTitleEdit:(id,title)=>e.updateCard(id,{title}),
    onCardDelete:id=>e.deleteCard(id),
    onCardWidthChange:(id,width)=>e.updateCard(id,{width}),
    onTaskSaveToDaily:()=>{new Notice('临时预览不会导出任务到日记。');},
    onTableContentChange:(name,content)=>e.updateTableContent(name,content),
   } as RenderCallbacks;
   const render=()=>{host.empty();renderTableSection(host,e.getData()!.columns[0]!,callbacks,app);};
   e.onDataUpdate(render);
   render();
  }
  onClose(){this.engine?.clearMemory();this.contentEl.empty();}
 }
 const preview = new Preview(realApp);
 preview.open();
 return {opened:true,cards:preview.contentEl.querySelectorAll('.apex-table-todo-card').length};
}
