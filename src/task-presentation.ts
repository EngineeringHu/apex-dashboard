/** Task presentation policy, independent of Obsidian, storage and the DOM. */
import { taskType, type TaskType } from './task-metadata';
import { taskIsOpen, taskStatus, type TaskState } from './task-status';

export interface TaskStyleSettings {
    incomplete: { enabled: boolean; color: string };
    types: { enabled: boolean; planned: string; temporary: string };
    linked: { enabled: boolean; palette: string[] };
}

export const DEFAULT_TASK_STYLES: TaskStyleSettings = {
    incomplete: { enabled: true, color: '#e5a126' },
    types: { enabled: true, planned: '#4f86c6', temporary: '#b279cf' },
    linked: { enabled: true, palette: ['#269d91', '#cf7361', '#8280ce', '#b28a32', '#559ec0', '#a56e99'] },
};

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const color = (value: unknown, fallback: string): string =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const enabled = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

/** Persist only validated colors and known fields; return fresh, independent objects. */
export function sanitizeTaskStyles(value: unknown): TaskStyleSettings {
    const raw = record(value), pending = record(raw.incomplete), types = record(raw.types), linked = record(raw.linked);
    const defaults = DEFAULT_TASK_STYLES;
    return {
        incomplete: { enabled: enabled(pending.enabled, defaults.incomplete.enabled), color: color(pending.color, defaults.incomplete.color) },
        types: { enabled: enabled(types.enabled, defaults.types.enabled), planned: color(types.planned, defaults.types.planned), temporary: color(types.temporary, defaults.types.temporary) },
        linked: { enabled: enabled(linked.enabled, defaults.linked.enabled), palette: defaults.linked.palette.map((fallback, i) =>
            color(Array.isArray(linked.palette) ? linked.palette[i] : undefined, fallback)) },
    };
}

/** Stable across reloads, card moves and occurrence order; never hash the task text. */
export function linkedTaskColor(id: string, palette: readonly string[]): string | undefined {
    if (!palette.length) return undefined;
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    return palette[(hash >>> 0) % palette.length];
}

export interface TaskAppearanceInput extends TaskState { taskType?: TaskType; syncId?: string }
export interface TaskAppearance {
    background?: string;
    pendingAccent?: string;
    typeColor?: string;
    linkedColor?: string;
    source: 'completed' | 'cancelled' | 'linked' | 'type' | 'incomplete' | 'theme';
}

/** Background rules are ordered here; badges and the pending edge are independent channels. */
export function resolveTaskAppearance(task: TaskAppearanceInput, settings: TaskStyleSettings): TaskAppearance {
    const typeColor = settings.types.enabled ? settings.types[taskType(task.taskType)] : undefined;
    const linkedColor = settings.linked.enabled && task.syncId ? linkedTaskColor(task.syncId, settings.linked.palette) : undefined;
    const status = taskStatus(task);
    const pendingAccent = taskIsOpen(task) && settings.incomplete.enabled ? settings.incomplete.color : undefined;
    const rules = [
        { source: 'linked' as const, color: linkedColor },
        { source: 'type' as const, color: typeColor },
        { source: 'incomplete' as const, color: pendingAccent },
    ];
    const winner = taskIsOpen(task) ? rules.find(rule => rule.color) : undefined;
    return { background: winner?.color, pendingAccent, typeColor, linkedColor,
        source: status === 'cancelled' || status === 'completed' ? status : winner?.source ?? 'theme' };
}
