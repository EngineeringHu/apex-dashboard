import { App, Notice } from 'obsidian';
import { renderSection } from '../src/renderer';
import { disposeTableLayouts } from '../src/table-layout-ui';
import { TableLayoutStore, type TableLayouts } from '../src/table-layout';
import { SyncEngine } from '../src/sync';
import { parse, serialize, generateEmptyWeeklyMarkdown } from '../src/parser';
import { insertTableTodo } from '../src/table-model';
import { DEFAULT_SETTINGS, type RenderCallbacks } from '../src/types';
import { captureScrollStates, restoreScrollStates } from '../src/scroll-preserve';

export function tableLayoutHarness(realApp: App, host: HTMLElement) {
    const data = parse(generateEmptyWeeklyMarkdown());
    let column = data.columns.find(c => c.sectionType === 'table')!;
    column = insertTableTodo(column, 2, 4, 'layout-demo-sunday', '周日安排');
    column = insertTableTodo(column, 3, 5, 'layout-demo-monday', '周一安排');
    column = insertTableTodo(column, 2, 3, 'layout-demo-week', '本周要务');
    column.cards[0]!.tasks = [{ text: '整理需求并准备本周项目评审材料，较长的任务会自动换行', checked: false },
        { text: '阅读 30 分钟', checked: false }];
    column.cards[1]!.tasks = [{ text: '完成设计讨论', checked: false, children: [{ text: '核对待确认事项', checked: false }] }];
    column.cards[2]!.tasks = [{ text: '推进项目交付', checked: false }];
    column.height = 600;
    data.columns = [column];
    const app = Object.create(realApp) as App;
    const reject = async () => { throw Error('合成预览禁止写入真实笔记'); };
    Object.defineProperty(app, 'vault', { value: Object.assign(Object.create(realApp.vault), {
        create: reject, modify: reject, process: reject, delete: reject,
        adapter: Object.assign(Object.create(realApp.vault.adapter), { write: reject, mkdir: reject, remove: reject }),
    }) });
    const engine = new SyncEngine(app, DEFAULT_SETTINGS);
    let contentWrites = 0, layoutWrites = 0, markdown = serialize(data);
    const layouts: TableLayouts = Object.create(null);
    const store = new TableLayoutStore(() => layouts, async () => { layoutWrites++; });
    engine.initMemory(data, async next => { contentWrites++; markdown = serialize(next); });
    const path = 'synthetic-table-layout.md', key = 'demo';
    const callbacks = {
        onColumnDelete: () => new Notice('此预览保留示例分区'),
        onColumnRename: () => {}, onColumnMove: () => {}, onColumnHeightChange: () => { throw Error('Layout reached Markdown height writer'); },
        onTaskUnlink: (id, taskPath) => engine.unlinkTask(id, taskPath),
        onTableTodoInsert: (name, row, col) => engine.insertTableTodo(name, row, col),
        onTaskAdd: (id, text, parent) => engine.addTask(id, text, parent),
        onTaskDelete: (id, taskPath) => engine.deleteTask(id, taskPath),
        onTaskEdit: (id, taskPath, text) => engine.editTask(id, taskPath, text),
        onCheckboxToggle: (id, taskPath, checked) => engine.toggleTask(id, taskPath, checked),
        onTaskMoveToCard: (source, taskPath, dest, destPath, mode, copy) => engine.moveTaskToCard(source, taskPath, dest, destPath, mode, copy),
        onTaskReorder: (id, from, to, before) => engine.reorderTask(id, from, to, before),
        onTaskNestInto: (id, from, to) => engine.nestTaskInto(id, from, to),
        onTaskNest: (id, taskPath) => engine.nestTask(id, taskPath),
        onTaskUnnest: (id, taskPath) => engine.unnestTask(id, taskPath),
        onTaskToggleCollapse: (id, taskPath) => engine.toggleCollapseTaskQuiet(id, taskPath),
        onTaskReminderEdit: (id, taskPath, reminder) => engine.editTaskReminder(id, taskPath, reminder),
        onTaskDailyNoteChange: (id, taskPath, note, text) => engine.setTaskDailyNote(id, taskPath, note, text),
        onCardTitleEdit: (id, title) => engine.updateCard(id, { title }),
        onCardDelete: id => engine.deleteCard(id),
        onTaskSaveToDaily: () => new Notice('此预览不导出日记'),
        getTableLayout: c => ({ layout: store.read(path, key, c.tableContent!, c.height), save: next => store.save(path, key, next) }),
        onTableContentChange: (name, content, change) => {
            void store.contentChanged(path, key, content, change);
            void engine.updateTableContent(name, content);
        },
    } as RenderCallbacks;
    const render = () => {
        const scroll = captureScrollStates(host);
        disposeTableLayouts(host); host.empty();
        host.appendChild(renderSection(engine.getData()!.columns[0]!, callbacks, app, engine.getData()!, DEFAULT_SETTINGS));
        restoreScrollStates(host, scroll);
    };
    engine.onDataUpdate(next => {
        void store.contentChanged(path, key, next.columns[0]!.tableContent!, 'cells');
        render();
    });
    render();
    return { engine, store, layouts, path, key, render, callbacks,
        stats: () => ({ contentWrites, layoutWrites, markdown }),
        dispose: () => { disposeTableLayouts(host); engine.clearMemory(); host.empty(); } };
}
