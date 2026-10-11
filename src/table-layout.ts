import { createHash, randomUUID } from 'crypto';
import { parseTableSectionRows } from './table-model';

export interface TableAxis {
    id: string;
    signature: string;
    size?: number;
}
export interface TableLayout {
    version: 1;
    sourceSignature: string;
    rows: TableAxis[];
    columns: TableAxis[];
    heightMode: 'auto' | 'limited';
    maxHeight: number;
}
export type TableLayouts = Record<string, Record<string, TableLayout>>;
export interface TableStructureChange {
    axis: 'rows' | 'columns';
    kind: 'insert' | 'delete';
    index: number;
}
export interface TableLayoutBinding {
    layout: TableLayout;
    save(layout: TableLayout): Promise<void>;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const axis = (signature: string): TableAxis => ({ id: randomUUID(), signature });
const bounded = (value: unknown, min: number, max: number): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : undefined;

export function tableHeaderRowCount(rows: string[][]): number {
    const index = rows.findIndex(row => row.some(cell => cell.replace(/\*/g, '').trim() === '角色') &&
        row.some(cell => cell.replace(/\*/g, '').trim() === '目标'));
    return index < 0 ? Math.min(2, rows.length) : index + 1;
}

/** No cell text is stored in plugin settings. Digests only reconcile external edits. */
function signatures(content: string): { rows: string[]; columns: string[] } {
    const rows = parseTableSectionRows(content);
    const count = Math.max(0, ...rows.map(row => row.length));
    return {
        rows: rows.map(row => digest(row)),
        columns: Array.from({ length: count }, (_, c) => digest(rows.slice(0, tableHeaderRowCount(rows)).map(row => row[c] ?? ''))),
    };
}

function reconcileAxis(previous: TableAxis[], next: string[], trusted: boolean): TableAxis[] {
    if (trusted && previous.length === next.length) {
        return next.map((signature, i) => ({ ...previous[i]!, signature }));
    }
    // Ambiguous repeated/empty rows or headings never inherit somebody else's size.
    const oldCounts = new Map<string, number>(), newCounts = new Map<string, number>();
    for (const entry of previous) oldCounts.set(entry.signature, (oldCounts.get(entry.signature) ?? 0) + 1);
    for (const signature of next) newCounts.set(signature, (newCounts.get(signature) ?? 0) + 1);
    const bySignature = new Map(previous.map(entry => [entry.signature, entry]));
    return next.map(signature => oldCounts.get(signature) === 1 && newCounts.get(signature) === 1
        ? { ...bySignature.get(signature)! } : axis(signature));
}

export function reconcileTableLayout(previous: TableLayout | undefined, content: string,
    change?: TableStructureChange | 'cells', legacyHeight?: number): TableLayout {
    const next = signatures(content);
    const sourceSignature = digest(parseTableSectionRows(content));
    const base: TableLayout = previous ? structuredClone(previous) : {
        version: 1, sourceSignature, rows: [], columns: [], heightMode: legacyHeight ? 'limited' : 'auto',
        maxHeight: bounded(legacyHeight, 160, 2000) ?? 640,
    };
    if (change && change !== 'cells') {
        const entries = base[change.axis];
        const expected = entries.length + (change.kind === 'insert' ? 1 : -1);
        if (expected === next[change.axis].length && change.index >= 0 &&
            change.index <= entries.length && (change.kind === 'insert' || change.index < entries.length)) {
            entries.splice(change.index, change.kind === 'delete' ? 1 : 0,
                ...(change.kind === 'insert' ? [axis('')] : []));
        } else change = undefined;
    }
    const trusted = !!change || previous?.sourceSignature === sourceSignature;
    base.rows = reconcileAxis(base.rows, next.rows, trusted);
    base.columns = reconcileAxis(base.columns, next.columns, trusted);
    base.sourceSignature = sourceSignature;
    return base;
}

export function sanitizeTableLayouts(value: unknown): TableLayouts {
    const out = Object.create(null) as TableLayouts;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [path, sections] of Object.entries(value as Record<string, unknown>)) {
        if (!sections || typeof sections !== 'object' || Array.isArray(sections)) continue;
        const clean = Object.create(null) as Record<string, TableLayout>;
        for (const [key, raw] of Object.entries(sections as Record<string, unknown>)) {
            const layout = raw as Partial<TableLayout> | null;
            if (!layout || layout.version !== 1 || !Array.isArray(layout.rows) || !Array.isArray(layout.columns)) continue;
            const readAxis = (entries: TableAxis[], row: boolean): TableAxis[] => entries.map(entry => ({
                id: typeof entry?.id === 'string' ? entry.id : randomUUID(),
                signature: typeof entry?.signature === 'string' && /^[a-f0-9]{64}$/.test(entry.signature) ? entry.signature : '',
                size: bounded(entry?.size, row ? 28 : 36, 1200),
            }));
            clean[key] = { version: 1, sourceSignature: typeof layout.sourceSignature === 'string' && /^[a-f0-9]{64}$/.test(layout.sourceSignature) ? layout.sourceSignature : '',
                rows: readAxis(layout.rows, true), columns: readAxis(layout.columns, false),
                heightMode: layout.heightMode === 'limited' ? 'limited' : 'auto',
                maxHeight: bounded(layout.maxHeight, 160, 2000) ?? 640 };
        }
        out[path] = clean;
    }
    return out;
}

/** Settings-only persistence: never holds a vault writer or a crypto token. */
export class TableLayoutStore {
    private dirty = false;
    private revision = 0;
    constructor(private readonly data: () => TableLayouts, private readonly persist: () => Promise<void>) {}

    private async flush(): Promise<void> {
        const revision = ++this.revision;
        this.dirty = true;
        await this.persist();
        if (revision === this.revision) this.dirty = false;
    }

    read(path: string, key: string, content: string, legacyHeight?: number): TableLayout {
        const previous = this.data()[path]?.[key];
        const next = reconcileTableLayout(previous, content, undefined, legacyHeight);
        // Publish reconciliation immediately, before a following local task edit can
        // reuse the previous ordering. Opening an untouched table creates no settings.
        if (previous && JSON.stringify(previous) !== JSON.stringify(next)) {
            void this.save(path, key, next).catch(error => console.error('Table layout reconciliation save failed', error));
        }
        return next;
    }
    async save(path: string, key: string, layout: TableLayout): Promise<void> {
        const data = this.data();
        const sections = data[path] ?? (data[path] = Object.create(null) as Record<string, TableLayout>);
        if (JSON.stringify(sections[key]) === JSON.stringify(layout) && !this.dirty) return;
        sections[key] = structuredClone(layout);
        await this.flush();
    }
    async contentChanged(path: string, key: string, content: string, change?: TableStructureChange | 'cells'): Promise<void> {
        const previous = this.data()[path]?.[key];
        if (previous) await this.save(path, key, reconcileTableLayout(previous, content, change));
    }
    async renameSection(path: string, oldKey: string, newKey: string): Promise<void> {
        const sections = this.data()[path];
        if (!sections?.[oldKey] || oldKey === newKey) return;
        sections[newKey] = sections[oldKey]!;
        delete sections[oldKey];
        await this.flush();
    }
    async renamePath(oldPath: string, newPath: string): Promise<void> {
        let changed = false;
        const data = this.data();
        for (const path of Object.keys(data)) {
            if (path !== oldPath && !path.startsWith(oldPath + '/')) continue;
            data[newPath + path.slice(oldPath.length)] = data[path]!;
            delete data[path];
            changed = true;
        }
        if (changed) await this.flush();
    }
}

/** Weekly roles are identified from headings, never from a hard-coded column count. */
export function tableColumnDefaults(content: string): { min: number; weight: number; role: string }[] {
    const rows = parseTableSectionRows(content);
    const count = Math.max(0, ...rows.map(row => row.length));
    const headers = rows.slice(0, tableHeaderRowCount(rows));
    const weekly = headers.some(row => row.some(cell => /星期[日一二三四五六]|周[一二三四五六日天]/.test(cell)));
    return Array.from({ length: count }, (_, c) => {
        const heading = headers.map(row => row[c] ?? '').join(' ').replace(/\*\*/g, '').trim();
        const hasCard = rows.some(row => /<!--\s*apex-todo:/.test(row[c] ?? ''));
        if (weekly && /➤|➜|→/.test(heading)) return { min: hasCard ? 128 : 36, weight: 0, role: 'arrow' };
        if (weekly && /角色/.test(heading)) return { min: hasCard ? 128 : 100, weight: 0.5, role: 'role' };
        if (weekly && /目标/.test(heading)) return { min: 160, weight: 1.5, role: 'goal' };
        if (weekly && /本周要务/.test(heading)) return { min: 160, weight: 1.5, role: 'task' };
        return { min: 128, weight: 1, role: weekly ? 'task' : 'generic' };
    });
}

export function calculateTableWidths(layout: TableLayout, defaults: { min: number; weight: number }[], available: number): number[] {
    const widths = defaults.map((entry, i) => Math.max(entry.min, layout.columns[i]?.size ?? entry.min));
    const spare = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0));
    const weight = defaults.reduce((sum, entry, i) => sum + (layout.columns[i]?.size === undefined ? entry.weight : 0), 0);
    return widths.map((width, i) => width + (weight && layout.columns[i]?.size === undefined
        ? spare * defaults[i]!.weight / weight : 0));
}
