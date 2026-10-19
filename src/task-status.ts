/** Task lifecycle policy. `checked` continues to mean successfully completed. */
export type TaskStatus = 'pending' | 'completed' | 'deferred' | 'cancelled';
export type TaskDisposition = 'deferred' | 'cancelled';
export interface TaskState { checked: boolean; taskStatus?: TaskDisposition }

export function taskStatus(task: TaskState): TaskStatus {
    return task.checked ? 'completed' : task.taskStatus ?? 'pending';
}
export const taskIsOpen = (task: TaskState): boolean => !task.checked && task.taskStatus !== 'cancelled';
export const taskMark = (task: TaskState): string => taskStatus(task) === 'cancelled' ? '-' : task.checked ? 'x' : ' ';
export function withTaskStatus<T extends TaskState>(task: T, status: TaskStatus): T {
    const { taskStatus: _old, ...rest } = task;
    return { ...rest, checked: status === 'completed',
        ...(status === 'deferred' || status === 'cancelled' ? { taskStatus: status } : {}) } as T;
}

type Tree = TaskState & { children?: Tree[] };
export function setTaskTreeStatus<T extends Tree>(task: T, status: TaskStatus): T {
    // Deferring has no scheduling side effect and does not overwrite child decisions.
    const children = status === 'deferred' ? task.children : task.children?.map(child => {
        if (status === 'completed' && taskStatus(child) === 'cancelled') return child;
        if (status === 'cancelled' && !taskIsOpen(child)) return child;
        return setTaskTreeStatus(child, status);
    });
    return { ...withTaskStatus(task, status), ...(children ? { children } : {}) };
}

export function recalcTaskStatus<T extends Tree>(task: T): T {
    const children = task.children ?? [];
    if (!children.length) return task;
    if (children.some(taskIsOpen)) return withTaskStatus(task, task.taskStatus === 'deferred' ? 'deferred' : 'pending');
    if (taskStatus(task) === 'cancelled' || children.every(child => taskStatus(child) === 'cancelled')) return withTaskStatus(task, 'cancelled');
    return withTaskStatus(task, 'completed');
}

/** Null means excluded, rather than zero completed work. Preserve equal sibling weighting. */
export function taskCompletion(task: Tree): number | null {
    if (taskStatus(task) === 'cancelled') return null;
    const children = (task.children ?? []).map(taskCompletion).filter((value): value is number => value !== null);
    return children.length ? children.reduce((sum, value) => sum + value, 0) / children.length : task.checked ? 1 : 0;
}
export function taskListCompletion(tasks: Tree[]): number {
    const values = tasks.map(taskCompletion).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
