import type { DashboardColumn, DashboardData, TaskItem } from './types';

const freshId = () => globalThis.crypto.randomUUID();

/** Shared identity plus a separate identity for each appearance in the table. */
export function linkTaskTree(task: TaskItem): TaskItem {
    const children = task.children?.map(linkTaskTree);
    if (task.syncId && task.syncInstanceId && children?.every((child, i) => child === task.children![i]) !== false) return task;
    return { ...task, syncId: task.syncId ?? freshId(), syncInstanceId: task.syncInstanceId ?? freshId(),
        ...(children ? { children } : {}) };
}
export function copyLinkedTaskTree(task: TaskItem): TaskItem {
    return { ...task, syncInstanceId: freshId(), ...(task.children ? { children: task.children.map(copyLinkedTaskTree) } : {}) };
}
export function detachTaskTree(task: TaskItem): TaskItem {
    const { syncId: _group, syncInstanceId: _instance, ...independent } = task;
    return { ...independent, ...(task.children ? { children: task.children.map(detachTaskTree) } : {}) };
}
export function checkTaskTree(task: TaskItem, checked: boolean): TaskItem {
    return { ...task, checked, ...(task.children ? { children: task.children.map(child => checkTaskTree(child, checked)) } : {}) };
}
function visit(tasks: TaskItem[], fn: (task: TaskItem) => void): void {
    for (const task of tasks) { fn(task); visit(task.children ?? [], fn); }
}
function instances(column: DashboardColumn): Map<string, TaskItem> {
    const result = new Map<string, TaskItem>();
    for (const card of column.cards) visit(card.tasks, task => {
        if (task.syncInstanceId) result.set(task.syncInstanceId, task);
    });
    return result;
}
const fields = ['text', 'checked', 'reminder', 'dailyNote'] as const;
type PayloadPatch = Partial<Pick<TaskItem, typeof fields[number]>>;
const childOrder = (task: TaskItem) => (task.children ?? []).map(child => child.syncId ?? '').join(',');

/** Detect logical cycles too (A contains B in one copy, B contains A in another). */
function assertAcyclic(column: DashboardColumn): number {
    const graph = new Map<string, Set<string>>();
    for (const card of column.cards) visit(card.tasks, task => {
        if (!task.syncId) return;
        const edges = graph.get(task.syncId) ?? new Set<string>();
        for (const child of task.children ?? []) if (child.syncId) edges.add(child.syncId);
        graph.set(task.syncId, edges);
    });
    const active = new Set<string>(), done = new Set<string>();
    const walk = (id: string) => {
        if (active.has(id)) throw Error('linked-task-cycle');
        if (done.has(id)) return;
        active.add(id);
        for (const child of graph.get(id) ?? []) walk(child);
        active.delete(id); done.add(id);
    };
    for (const id of graph.keys()) walk(id);
    return graph.size;
}

/** One edit transaction: fan out changed fields/child lists, never root positions or collapse state. */
function synchronizeColumn(before: DashboardColumn, proposed: DashboardColumn): DashboardColumn {
    const normalize = (task: TaskItem): TaskItem => task.syncId ? linkTaskTree(task)
        : task.children ? { ...task, children: task.children.map(normalize) } : task;
    let next = { ...proposed, cards: proposed.cards.map(card => ({ ...card, tasks: card.tasks.map(normalize) })) };
    const groupCount = assertAcyclic(next);
    const previous = instances(before);
    const payloads = new Map<string, PayloadPatch>();
    const structures = new Map<string, TaskItem[]>();
    for (const [instance, task] of instances(next)) {
        const old = previous.get(instance);
        if (!task.syncId || old?.syncId !== task.syncId) continue;
        const patch: PayloadPatch = { ...payloads.get(task.syncId) };
        for (const field of fields) if (task[field] !== old[field]) Object.assign(patch, { [field]: task[field] });
        if (Object.keys(patch).length) payloads.set(task.syncId, patch);
        if (childOrder(task) !== childOrder(old)) structures.set(task.syncId, task.children ?? []);
    }
    if (!payloads.size && !structures.size) return next;
    // Parent completion may need another pass when its shared child is updated later in the table.
    for (let pass = 0; pass <= groupCount + 1; pass++) {
        const snapshot = JSON.stringify(next.cards);
        const apply = (task: TaskItem, ancestors: Set<string>): TaskItem => {
            if (task.syncId && ancestors.has(task.syncId)) throw Error('linked-task-cycle');
            const seen = new Set(ancestors);
            if (task.syncId) seen.add(task.syncId);
            const patch = task.syncId ? payloads.get(task.syncId) : undefined;
            let result = patch ? { ...task, ...patch } : task;
            const structure = task.syncId ? structures.get(task.syncId) : undefined;
            if (structure) {
                const available = [...(task.children ?? [])];
                result = { ...result, children: structure.map(template => {
                    const index = available.findIndex(child => child.syncId === template.syncId);
                    return index < 0 ? copyLinkedTaskTree(template) : available.splice(index, 1)[0]!;
                }) };
            }
            if (result.children) {
                const children = result.children.map(child => apply(child, seen));
                result = { ...result, children };
                const old = (task.syncInstanceId && previous.get(task.syncInstanceId)) || task;
                const changed = childOrder(result) !== childOrder(old)
                    || children.some((child, index) => child.checked !== old.children?.[index]?.checked);
                if (changed && children.length) {
                    result = { ...result, checked: children.every(child => child.checked) };
                    if (result.syncId) payloads.set(result.syncId, { ...payloads.get(result.syncId), checked: result.checked });
                }
            }
            return result;
        };
        next = { ...next, cards: next.cards.map(card => ({ ...card, tasks: card.tasks.map(task => apply(task, new Set())) })) };
        if (JSON.stringify(next.cards) === snapshot) return next;
    }
    throw Error('linked-task-cycle');
}

/** Table-local scope deliberately prevents matching IDs in another week/section from syncing. */
export function synchronizeLinkedTasks(before: DashboardData, proposed: DashboardData): DashboardData {
    return { ...proposed, columns: proposed.columns.map((column, index) =>
        column.sectionType === 'table' && before.columns[index]?.sectionType === 'table' && column !== before.columns[index]
            ? synchronizeColumn(before.columns[index]!, column) : column) };
}
