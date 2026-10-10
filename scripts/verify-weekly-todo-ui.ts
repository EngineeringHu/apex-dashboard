import { App, TFile } from 'obsidian';
import { renderTableSection } from '../src/renderer';
import { parse, serialize, generateEmptyWeeklyMarkdown } from '../src/parser';
import { SyncEngine } from '../src/sync';
import { DEFAULT_SETTINGS, type RenderCallbacks } from '../src/types';

export async function run(realApp: App) {
    const assert = (value: unknown, message: string) => { if (!value) throw Error(message); };
    const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
    const host = document.createElement('div');
    host.className = 'apex-dashboard-root';
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '1400px' });
    document.body.appendChild(host);
    const diary = Object.assign(Object.create(TFile.prototype), {
        path: '合成测试日记/2026-10-09.md', name: '2026-10-09.md', basename: '2026-10-09', extension: 'md',
    }) as TFile;
    let opened: TFile | undefined;
    const app = Object.create(realApp) as App;
    Object.defineProperty(app, 'vault', { value: Object.assign(Object.create(realApp.vault), {
        getMarkdownFiles: () => [diary],
        getAbstractFileByPath: (path: string) => path === diary.path ? diary : null,
    }) });
    Object.defineProperty(app, 'workspace', { value: Object.assign(Object.create(realApp.workspace), {
        getLeaf: () => ({ openFile: async (file: TFile) => { opened = file; } }),
    }) });
    const initial = parse(generateEmptyWeeklyMarkdown());
    const table = initial.columns.find(c => c.sectionType === 'table')!;
    const engine = new SyncEngine(app, DEFAULT_SETTINGS);
    let markdown = '';
    engine.initMemory(initial, async data => { markdown = serialize(data); });
    const callbacks = {
        onTableTodoInsert: (name: string, row: number, col: number) => engine.insertTableTodo(name, row, col),
        onTaskAdd: (id: string, text: string) => engine.addTask(id, text),
        onCheckboxToggle: (id: string, path: number[], checked: boolean) => engine.toggleTask(id, path, checked),
        onTaskMoveToCard: (...args: Parameters<SyncEngine['moveTaskToCard']>) => engine.moveTaskToCard(...args),
        onTaskReorder: (...args: Parameters<SyncEngine['reorderTask']>) => engine.reorderTask(...args),
        onTaskNestInto: (...args: Parameters<SyncEngine['nestTaskInto']>) => engine.nestTaskInto(...args),
        onTaskDailyNoteChange: (...args: Parameters<SyncEngine['setTaskDailyNote']>) => engine.setTaskDailyNote(...args),
        onTableContentChange: (name: string, content: string) => engine.updateTableContent(name, content),
        onTaskEdit: (...args: Parameters<SyncEngine['editTask']>) => engine.editTask(...args),
        onCardDelete: (id: string) => engine.deleteCard(id),
    } as unknown as RenderCallbacks;
    const render = () => {
        host.empty();
        renderTableSection(host, engine.getData()!.columns.find(c => c.name === table.name)!, callbacks, app);
    };
    engine.onDataUpdate(render);
    const checks: string[] = [];
    const modalsBefore = new Set(document.querySelectorAll('.modal-container'));
    try {
        render();
        (host.querySelector('.apex-table-insert-todo') as HTMLButtonElement).click();
        await tick();
        assert(host.querySelectorAll('.apex-table-todo-card').length === 1, 'insert button creates a standard card');
        (host.querySelector('.apex-table-insert-todo') as HTMLButtonElement).click();
        await tick();
        assert(host.querySelectorAll('.apex-table-todo-card').length === 2, 'second cell gets its own card');
        checks.push('insert standard To-Do cards through cell buttons');
        const input = host.querySelector('.dashboard-task-input') as HTMLInputElement;
        input.value = '合成任务';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await tick();
        assert(host.querySelector('.dashboard-task-item')?.textContent?.includes('合成任务'), 'add task');
        (host.querySelector('.dashboard-task-daily-link') as HTMLButtonElement).click();
        await tick();
        const linkModal = [...document.querySelectorAll('.modal-container')].find(el => !modalsBefore.has(el))!;
        assert(linkModal, 'link dialog opened');
        (linkModal.querySelector('button') as HTMLButtonElement).click();
        await tick();
        const picker = [...document.querySelectorAll('.modal-container')].find(el => !modalsBefore.has(el))!;
        (picker.querySelector('.dashboard-pathpicker-item') as HTMLElement).click();
        await tick();
        assert(markdown.includes('apex-daily:'), 'diary association saved');
        (host.querySelector('.dashboard-task-daily-open') as HTMLButtonElement).click();
        await tick();
        assert(opened === diary, 'jump opens selected diary file');
        checks.push('choose existing diary through real modal; jump opens exact linked TFile');

        const sourceItem = host.querySelector('.dashboard-task-item') as HTMLElement;
        const targetList = host.querySelectorAll('.dashboard-task-list')[1] as HTMLElement;
        const transfer = new DataTransfer();
        sourceItem.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
        targetList.dispatchEvent(over);
        assert(over.defaultPrevented, 'empty card accepts dragover');
        targetList.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        sourceItem.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
        await tick();
        const columns = parse(markdown).columns;
        const cards = columns.find(c => c.name === table.name)!.cards;
        assert(cards[0]!.tasks.length === 0 && cards[1]!.tasks.length === 1, 'drop moves once, without duplication');
        assert(cards[1]!.tasks[0]!.dailyNote === diary.path, 'drag retains diary association');
        checks.push('real drag events move task into empty cell card once and preserve diary link');
        const checkbox = host.querySelector('.dashboard-task-checkbox') as HTMLInputElement;
        checkbox.click();
        await tick();
        assert(parse(markdown).columns.find(c => c.name === table.name)!.cards[1]!.tasks[0]!.checked, 'checkbox saved');
        render();
        assert((host.querySelector('.dashboard-task-checkbox') as HTMLInputElement).checked, 'completion survives rerender');
        assert(host.querySelector('.dashboard-task-daily-open'), 'link survives rerender');
        checks.push('checkbox and diary link survive save/reload');
        return { passed: true, checks, vaultWrites: 0 };
    } finally {
        for (const modal of document.querySelectorAll('.modal-container')) {
            if (!modalsBefore.has(modal)) (modal.querySelector('.modal-close-button, .modal-header-button') as HTMLElement | null)?.click();
        }
        host.remove();
        engine.clearMemory();
    }
}
