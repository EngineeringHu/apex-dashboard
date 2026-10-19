import type { TaskStatus } from '../src/task-status';
import { App } from 'obsidian';
import { tableLayoutHarness } from './table-layout-harness';
import { TaskStyleModal, refreshTableTaskStyles } from '../src/task-presentation-ui';
import { sanitizeTaskStyles } from '../src/task-presentation';
import { t } from '../src/i18n';

export async function run(app: App) {
    const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
    const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const host = document.body.createDiv({ cls: 'apex-dashboard-root apex-task-style-test', attr: { 'data-theme': 'earth' } });
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px';
    const harness = tableLayoutHarness(app, host), engine = harness.engine;
    let settings = sanitizeTaskStyles(undefined), saves = 0;
    const checks: string[] = [];
    let modal: TaskStyleModal | undefined;
    const openSettings = () => {
        modal = new TaskStyleModal(app, settings, async next => { settings = next; saves++; refreshTableTaskStyles(host, settings); });
        modal.open();
    };
    Object.assign(harness.callbacks, {
        getTaskStyles: () => settings,
        onTaskStatusChange: (id: string, path: number[], status: TaskStatus) => engine.setTaskStatus(id, path, status),
        onTaskStyleSettings: openSettings,
        onTaskTypeChange: (id: string, path: number[], type: 'planned' | 'temporary') => engine.setTaskType(id, path, type),
    });
    const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.dashboard-task-item'));
    const pendingRow = () => rows().find(row => row.dataset.cardId === 'layout-demo-sunday' && row.querySelector('.dashboard-task-text')?.textContent?.includes('整理需求'))!;
    const chooseStatus = async (row: HTMLElement, status: TaskStatus) => {
        const before = harness.stats().markdown;
        row.querySelector<HTMLButtonElement>('.dashboard-task-status')!.click();
        assert(harness.stats().markdown === before, 'opening status choices does not mutate tasks');
        const option = Array.from(document.querySelectorAll<HTMLElement>('.menu-item')).find(el =>
            el.textContent?.trim() === t('task.status.action.' + status));
        assert(option, 'status option exists: ' + status); option!.click(); await tick();
    };
    try {
        harness.render();
        assert(pendingRow().dataset.taskType === 'planned', 'legacy tasks default to planned');
        pendingRow().querySelector<HTMLButtonElement>('.dashboard-task-type')!.click();
        const option = Array.from(document.querySelectorAll<HTMLElement>('.menu-item')).find(el => el.textContent?.includes(t('task.type.temporary')));
        assert(option, 'type menu has temporary option'); option!.click(); await tick();
        assert(pendingRow().dataset.taskType === 'temporary', 'menu changes type');
        const badge = pendingRow().querySelector<HTMLElement>('.dashboard-task-type')!;
        assert(badge.clientWidth >= badge.scrollWidth, 'type icon fits inside narrow task row');
        assert(badge.querySelector('svg') && badge.textContent === '', 'type uses an icon without a visible text label');
        assert(badge.title.includes(t('task.type.temporary')) && badge.getAttribute('aria-label')?.includes(t('task.type.temporary')), 'tooltip and accessible name identify the current type');
        assert(badge.parentElement === pendingRow() && getComputedStyle(badge).gridRowStart === '1', 'type icon sits beside the task text');
        assert(pendingRow().style.getPropertyValue('--task-fill') === settings.types.temporary, 'temporary fill applied');
        await engine.moveTaskToCard('layout-demo-sunday', [0], 'layout-demo-monday', [1], 'before', true); await tick();
        const linked = rows().filter(row => row.dataset.taskSyncId === pendingRow().dataset.taskSyncId);
        assert(linked.length === 2, 'two linked occurrences exist');
        assert(linked[0]!.style.getPropertyValue('--task-fill') === linked[1]!.style.getPropertyValue('--task-fill'), 'copies use same color');
        assert(linked.every(row => row.dataset.taskStyle === 'linked'), 'linked background overrides temporary background');
        assert(getComputedStyle(linked[0]!).boxShadow.includes('inset'), 'pending edge remains visible');
        await chooseStatus(linked[0]!, 'deferred');
        assert(pendingRow().dataset.taskStatus === 'deferred', 'deferred state is visible');
        await chooseStatus(pendingRow(), 'cancelled');
        assert(rows().filter(row => row.dataset.taskSyncId === pendingRow().dataset.taskSyncId).every(row => row.dataset.taskStatus === 'cancelled' && row.dataset.taskStyle === 'cancelled'), 'cancelling closes and mutes linked tasks');
        assert(harness.stats().markdown.includes('- [-]'), 'cancelled status persists separately from completion');
        await chooseStatus(pendingRow(), 'pending');
        assert(pendingRow().dataset.taskStatus === 'pending', 'cancelled task can be reopened');
        await chooseStatus(pendingRow(), 'completed');
        const done = rows().filter(row => row.dataset.taskSyncId === pendingRow().dataset.taskSyncId);
        assert(done.every(row => row.dataset.taskStyle === 'completed'), 'linked completion removes fill');
        assert(done.every(row => !row.style.getPropertyValue('--task-pending')), 'completed tasks have no pending accent');
        await chooseStatus(done[0]!, 'pending');
        assert(pendingRow().dataset.taskStyle === 'linked', 'unchecking restores linked fill');
        checks.push('real type and status menus, linked completion/deferral/cancellation/reopen, saved states and colors');

        const before = harness.stats().markdown;
        const clickModalButton = (text: string) => {
            const button = Array.from(modal!.contentEl.querySelectorAll<HTMLButtonElement>('button')).find(el => el.textContent === text);
            assert(button, 'modal button exists: ' + text); button!.click();
        };
        host.querySelector<HTMLButtonElement>('.apex-table-task-style-toolbar button')!.click();
        assert(modal!.contentEl.querySelectorAll('.dashboard-task-item').length === 7, 'settings includes live examples');
        await Promise.race([new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            new Promise(resolve => setTimeout(resolve, 300))]);
        const remote = (window as any).require('@electron/remote');
        const rect = modal!.modalEl.getBoundingClientRect();
        const screenshot = await Promise.race([remote.getCurrentWindow().webContents.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }),
            new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))]);
        const fs = (window as any).require('fs'), path = (window as any).require('path');
        if (screenshot) fs.writeFileSync(path.join((globalThis as any).__apexTestOutputDir, 'task-style-settings.png'), screenshot.toPNG());
        const color = modal!.contentEl.querySelector<HTMLInputElement>('input[type=color]')!;
        color.value = '#ff3366'; color.dispatchEvent(new Event('input', { bubbles: true })); color.dispatchEvent(new Event('change', { bubbles: true }));
        assert(modal!.contentEl.querySelector<HTMLElement>('.dashboard-task-item')!.style.getPropertyValue('--task-pending') === '#ff3366', 'preview uses changed pending color');
        clickModalButton(t('common.cancel')); await tick();
        assert(saves === 0 && settings.incomplete.color !== '#ff3366', 'cancel discards draft');
        openSettings();
        const nextColor = modal!.contentEl.querySelector<HTMLInputElement>('input[type=color]')!;
        nextColor.value = '#ff3366'; nextColor.dispatchEvent(new Event('input', { bubbles: true })); nextColor.dispatchEvent(new Event('change', { bubbles: true }));
        const originalRow = pendingRow();
        clickModalButton(t('common.save')); await tick();
        assert(saves === 1 && settings.incomplete.color === '#ff3366', 'save persists settings');
        assert(pendingRow() === originalRow, 'settings update preserves task DOM');
        assert(originalRow.style.getPropertyValue('--task-pending') === '#ff3366', 'saved settings apply to existing tasks');
        assert(harness.stats().markdown === before, 'style settings never write task content');
        checks.push('settings entry, live preview, cancel/save, in-place refresh without Markdown changes');
        settings = sanitizeTaskStyles({ ...settings, incomplete: { ...settings.incomplete, enabled: false },
            types: { ...settings.types, enabled: false }, linked: { ...settings.linked, enabled: false } });
        refreshTableTaskStyles(host, settings);
        assert(pendingRow().dataset.taskStyle === 'theme', 'disabling all rules restores theme styling');
        assert(getComputedStyle(pendingRow()).boxShadow === 'none', 'legacy incomplete CSS does not override disabled rules');
        assert(pendingRow().querySelector('.dashboard-task-type')?.getAttribute('aria-label')?.includes(t('task.type.temporary')), 'type remains identifiable when colors are disabled');
        checks.push('disabled rules restore theme styling while retaining accessible type icons');
        return { passed: true, checks, vaultWrites: 0 };
    } finally { modal?.close(); harness.dispose(); host.remove(); }
}
