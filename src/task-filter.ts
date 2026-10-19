import { TASK_TYPES, taskType, type TaskType } from './task-metadata';
import { taskStatus, type TaskState, type TaskStatus } from './task-status';

export const TASK_FILTER_STATUSES: readonly TaskStatus[] = ['pending', 'deferred', 'cancelled', 'completed'];

/** Missing dimension means all; an explicit empty selection means none. */
export interface TaskFilter {
    statuses?: TaskStatus[];
    types?: TaskType[];
}

export function normalizeTaskFilter(raw: unknown): TaskFilter | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const value = raw as Record<string, unknown>;
    const statuses = value.statuses, types = value.types;
    const result: TaskFilter = {};
    if (Array.isArray(statuses)) result.statuses = TASK_FILTER_STATUSES.filter(status => statuses.includes(status));
    if (Array.isArray(types)) result.types = TASK_TYPES.filter(type => types.includes(type));
    return result.statuses || result.types ? result : undefined;
}

export function matchesTaskFilter(task: TaskState & { taskType?: TaskType }, filter?: TaskFilter): boolean {
    return (!filter?.statuses || filter.statuses.includes(taskStatus(task)))
        && (!filter?.types || filter.types.includes(taskType(task.taskType)));
}
