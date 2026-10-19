import { Menu, setIcon } from 'obsidian';
import { t } from './i18n';
import { taskStatus, type TaskState, type TaskStatus } from './task-status';

export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
    pending: 'square', completed: 'square-check', deferred: 'clock-3', cancelled: 'circle-slash',
};

/** The button opens a choice; merely opening/dismissing it never edits a task. */
export function renderTaskStatusControl(host: HTMLElement, task: TaskState, change: (status: TaskStatus) => void): void {
    const status = taskStatus(task);
    host.dataset.taskStatus = status;
    const label = t('task.status.' + status) + ' · ' + t('task.status.choose');
    const button = host.createEl('button', { cls: 'dashboard-task-checkbox dashboard-task-status',
        attr: { type: 'button', title: label, 'aria-label': label, 'aria-haspopup': 'menu' } });
    setIcon(button, TASK_STATUS_ICONS[status]);
    button.querySelector('svg')?.setAttribute('aria-hidden', 'true');
    button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const menu = new Menu();
        const options: TaskStatus[] = status === 'completed' || status === 'cancelled'
            ? ['pending'] : ['completed', 'deferred', 'cancelled'];
        if (status === 'deferred') options.push('pending');
        for (const next of options) menu.addItem(entry => entry.setTitle(t('task.status.action.' + next))
            .setIcon(TASK_STATUS_ICONS[next]).setChecked(next === status).onClick(() => { if (next !== status) change(next); }));
        const rect = button.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    });
}
