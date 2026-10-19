import { t } from './i18n';
import { TASK_TYPES } from './task-metadata';
import { TASK_FILTER_STATUSES, type TaskFilter } from './task-filter';

/** Shared by query settings and the live result toolbar. Never edits task data. */
export function renderTaskFilters(host: HTMLElement, initial: TaskFilter | undefined, change: (filter: TaskFilter) => void): void {
    let filter: TaskFilter = { ...initial };
    const root = host.createDiv({ cls: 'dashboard-task-filters' });
    const group = <K extends keyof TaskFilter>(key: K, values: NonNullable<TaskFilter[K]>, prefix: string): void => {
        const fieldset = root.createEl('fieldset');
        fieldset.createEl('legend', { text: t('taskFilter.' + key) });
        for (const value of values) {
            const label = fieldset.createEl('label', { cls: 'dashboard-task-filter-option' });
            const input = label.createEl('input', { type: 'checkbox', attr: { 'data-filter': key, value } });
            input.checked = !filter[key] || (filter[key] as string[]).includes(value);
            label.createSpan({ text: t(prefix + value) });
            input.addEventListener('change', () => {
                const selected = new Set<string>(filter[key] ?? values);
                if (input.checked) selected.add(value); else selected.delete(value);
                filter = { ...filter, [key]: values.filter(item => selected.has(item)) };
                change(filter);
            });
        }
    };
    group('statuses', [...TASK_FILTER_STATUSES], 'task.status.');
    group('types', [...TASK_TYPES], 'task.type.');
    root.createDiv({ cls: 'dashboard-task-filter-hint', text: t('taskFilter.hint') });
}
