import { App, Menu, Modal, Notice, Setting, setIcon } from 'obsidian';
import { t } from './i18n';
import { TASK_TYPES, taskType, type TaskType } from './task-metadata';
import { resolveTaskAppearance, sanitizeTaskStyles, type TaskAppearanceInput, type TaskStyleSettings } from './task-presentation';
import { renderTaskStatusControl } from './task-status-ui';
import { taskIsOpen, withTaskStatus } from './task-status';

const TASK_TYPE_ICONS: Record<TaskType, string> = { planned: 'calendar-days', temporary: 'zap' };

export function renderTaskTypeControl(host: HTMLElement, task: TaskAppearanceInput, change?: (type: TaskType) => void): void {
    const currentType = taskType(task.taskType);
    const label = t('task.type.' + currentType) + (change ? ' · ' + t('task.changeType') : '');
    host.dataset.taskType = currentType;
    if (task.syncId) host.dataset.taskSyncId = task.syncId;
    const badge = host.createEl(change ? 'button' : 'span', {
        cls: 'dashboard-task-type', attr: { title: label, 'aria-label': label },
    });
    setIcon(badge, TASK_TYPE_ICONS[currentType]);
    badge.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    if (!change) { badge.setAttribute('role', 'img'); return; }
    badge.setAttribute('type', 'button');
    badge.addEventListener('click', event => {
        event.stopPropagation();
        const menu = new Menu();
        for (const type of TASK_TYPES) menu.addItem(entry => entry.setTitle(t('task.type.' + type)).setIcon(TASK_TYPE_ICONS[type])
            .setChecked(type === taskType(task.taskType)).onClick(() => change(type)));
        const rect = badge.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    });
}

export function applyTableTaskStyle(row: HTMLElement, settings: TaskStyleSettings): void {
    const checkbox = row.querySelector<HTMLInputElement>(':scope > .dashboard-task-checkbox');
    const appearance = resolveTaskAppearance({ checked: checkbox?.checked ?? false,
        ...(row.dataset.taskStatus === 'completed' ? { checked: true } : {}),
        ...(row.dataset.taskStatus === 'cancelled' || row.dataset.taskStatus === 'deferred' ? { taskStatus: row.dataset.taskStatus } : {}),
        taskType: taskType(row.dataset.taskType), syncId: row.dataset.taskSyncId }, settings);
    row.dataset.taskStyle = appearance.source;
    row.classList.add('dashboard-task-item--styled');
    row.classList.toggle('dashboard-task-item--colored', !!appearance.background);
    row.classList.toggle('dashboard-task-item--pending-accent', !!appearance.pendingAccent);
    row.classList.toggle('dashboard-task-item--type-color', !!appearance.typeColor);
    row.classList.toggle('dashboard-task-item--linked-color', !!appearance.linkedColor);
    for (const [name, value] of Object.entries({
        '--task-fill': appearance.background, '--task-pending': appearance.pendingAccent,
        '--task-type-color': appearance.typeColor, '--task-linked-color': appearance.linkedColor,
    })) {
        if (value) row.style.setProperty(name, value);
        else row.style.removeProperty(name);
    }
}

/** Refresh presentation in place, preserving edits, scroll, folds and encrypted section state. */
export function refreshTableTaskStyles(root: HTMLElement, settings: TaskStyleSettings): void {
    root.querySelectorAll<HTMLElement>('.apex-table-todo-card .dashboard-task-item')
        .forEach(row => applyTableTaskStyle(row, settings));
}

export class TaskStyleModal extends Modal {
    private draft: TaskStyleSettings;
    constructor(app: App, settings: TaskStyleSettings, private readonly save: (settings: TaskStyleSettings) => Promise<void>) {
        super(app);
        this.draft = sanitizeTaskStyles(settings);
    }
    onOpen(): void {
        this.titleEl.setText(t('taskStyle.title'));
        this.modalEl.addClass('apex-task-style-modal');
        this.render();
    }
    private render(): void {
        this.contentEl.empty();
        const content = this.contentEl;
        content.createEl('p', { text: t('taskStyle.scope') });
        content.createEl('p', { cls: 'apex-task-style-help', text: t('taskStyle.priority') });
        const preview = content.createDiv({ cls: 'apex-task-style-preview apex-dashboard-root' });
        const live = this.app.workspace.activeLeaf?.view.containerEl.querySelector<HTMLElement>('.apex-dashboard-root');
        preview.dataset.theme = live?.dataset.theme ?? 'earth';
        const update = () => {
            preview.empty();
            const card = preview.createDiv({ cls: 'apex-table-todo-card' });
            const samples: (TaskAppearanceInput & { label: string })[] = [
                { checked: false, taskType: 'planned', label: t('taskStyle.samplePlanned') },
                { checked: false, taskType: 'temporary', label: t('taskStyle.sampleTemporary') },
                { checked: false, taskType: 'temporary', syncId: 'sample-linked-task', label: t('taskStyle.sampleLinkedA') },
                { checked: false, taskType: 'temporary', syncId: 'sample-linked-task', label: t('taskStyle.sampleLinkedB') },
                { checked: true, taskType: 'planned', label: t('taskStyle.sampleDone') },
                { checked: false, taskStatus: 'deferred', taskType: 'planned', label: t('taskStyle.sampleDeferred') },
                { checked: false, taskStatus: 'cancelled', taskType: 'temporary', label: t('taskStyle.sampleCancelled') },
            ];
            for (const sample of samples) {
                const row = card.createDiv({ cls: 'dashboard-task-item' });
                let current = sample;
                const render = () => {
                    row.empty();
                    renderTaskStatusControl(row, current, status => { current = withTaskStatus(current, status); render(); });
                    row.createSpan({ cls: 'dashboard-task-text' + (!taskIsOpen(current) ? ' dashboard-task-text--done' : ''), text: current.label });
                    renderTaskTypeControl(row, current);
                    applyTableTaskStyle(row, this.draft);
                };
                render();
            }
        };
        new Setting(content).setName(t('taskStyle.incomplete')).addToggle(toggle => toggle.setValue(this.draft.incomplete.enabled)
            .onChange(value => { this.draft.incomplete.enabled = value; update(); }))
            .addColorPicker(picker => picker.setValue(this.draft.incomplete.color).onChange(value => { this.draft.incomplete.color = value; update(); }));
        new Setting(content).setName(t('taskStyle.types')).addToggle(toggle => toggle.setValue(this.draft.types.enabled)
            .onChange(value => { this.draft.types.enabled = value; update(); }));
        for (const type of TASK_TYPES) new Setting(content).setName(t('task.type.' + type)).addColorPicker(picker =>
            picker.setValue(this.draft.types[type]).onChange(value => { this.draft.types[type] = value; update(); }));
        new Setting(content).setName(t('taskStyle.linked')).setDesc(t('taskStyle.linkedHelp')).addToggle(toggle =>
            toggle.setValue(this.draft.linked.enabled).onChange(value => { this.draft.linked.enabled = value; update(); }));
        const palette = new Setting(content).setName(t('taskStyle.palette'));
        this.draft.linked.palette.forEach((value, index) => palette.addColorPicker(picker =>
            picker.setValue(value).onChange(next => { this.draft.linked.palette[index] = next; update(); })));
        new Setting(content).addButton(button => button.setButtonText(t('taskStyle.reset')).onClick(() => {
            this.draft = sanitizeTaskStyles(undefined); this.render();
        })).addButton(button => button.setButtonText(t('common.cancel')).onClick(() => this.close()))
            .addButton(button => button.setButtonText(t('common.save')).setCta().onClick(async () => {
                button.setDisabled(true);
                try { await this.save(sanitizeTaskStyles(this.draft)); this.close(); }
                catch (error) { console.error('Task style save failed', error); new Notice(t('taskStyle.saveFailed')); button.setDisabled(false); }
            }));
        update();
    }
    onClose(): void { this.contentEl.empty(); }
}
