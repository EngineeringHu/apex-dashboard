import type { TaskDisposition } from './task-status';

export const TASK_TYPES = ['planned', 'temporary'] as const;
export type TaskType = typeof TASK_TYPES[number];
export const taskType = (value: unknown): TaskType => value === 'temporary' ? 'temporary' : 'planned';

/** Optional suffix leaves legacy tasks byte-compatible until their type is explicitly set. */
export function readTaskMetadataSuffix(text: string): { text: string; taskType?: TaskType; taskStatus?: TaskDisposition } {
    const result: { text: string; taskType?: TaskType; taskStatus?: TaskDisposition } = { text };
    // Allow type and lifecycle suffixes in either order; keep unknown metadata intact.
    for (;;) {
        const type = result.text.match(/\s*<!--apex-task-type:(planned|temporary)-->\s*$/);
        const status = result.text.match(/\s*<!--apex-task-status:(deferred)-->\s*$/);
        if (type) { result.taskType ??= type[1] as TaskType; result.text = result.text.slice(0, type.index); }
        else if (status) { result.taskStatus ??= status[1] as TaskDisposition; result.text = result.text.slice(0, status.index); }
        else return result;
    }
}
