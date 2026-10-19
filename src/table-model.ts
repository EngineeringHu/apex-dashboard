import { readTaskMetadataSuffix } from './task-metadata';
import type { DashboardCard, DashboardColumn, TaskItem } from './types';

function splitTableCells(inner: string): string[] {
    const cells: string[] = [];
    let value = '', wiki = false;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i]!;
        if (ch === '\\' && inner[i + 1] === '|') { value += '|'; i++; continue; }
        if (ch === '[' && inner[i + 1] === '[') wiki = true;
        if (ch === ']' && inner[i + 1] === ']') wiki = false;
        if (ch === '|' && !wiki) { cells.push(value.trim()); value = ''; }
        else value += ch;
    }
    cells.push(value.trim());
    return cells;
}
function escapeTableCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
export const TABLE_CARD_PATTERN = /<!--\s*apex-todo:([a-zA-Z0-9_-]+)\s*-->/;
export function tableCardId(text: string): string | undefined {
    return text.match(TABLE_CARD_PATTERN)?.[1];
}
export function tableCardMarker(id: string): string {
    return '<!-- apex-todo:' + id + ' -->';
}
export function legacyTableTasks(text: string): TaskItem[] {
    return text.replace(TABLE_CARD_PATTERN, '').split(/<br\s*\/?>/i).map(line => line.trim()).filter(Boolean).map(line => {
        const match = line.match(/^(?:-\s*)?\[([ xX-])\]\s*(.*)$/);
        const typed = readTaskMetadataSuffix(match ? match[2]! : line);
        const checked = !!match && match[1]!.toLowerCase() === 'x';
        return { ...typed, checked, taskStatus: match?.[1] === '-' ? 'cancelled' : checked ? undefined : typed.taskStatus };
    });
}
export function insertTableTodo(column: DashboardColumn, row: number, col: number, id: string, title: string): DashboardColumn {
    const grid = buildMergedTableGrid(parseTableSectionRows(column.tableContent ?? ''));
    const cell = grid[row]?.find(c => c.col === col);
    if (!cell || tableCardId(cell.text)) return column;
    const card: DashboardCard = {
        id, title, type: 'task', column: column.name, body: '', tasks: legacyTableTasks(cell.text),
        docs: [], url: '', wikiLink: '', progress: -1, streak: 0, dueDate: '', blockquote: '',
        color: '', coverImage: '', width: 0, size: 'M', gridCols: 0, gridRows: 0, gridCol: 0, gridRow: 0,
    };
    cell.text = tableCardMarker(id);
    return { ...column, tableContent: serializeMergedGrid(grid), cards: [...column.cards, card] };
}

export interface TableSectionCell {
	text: string;
	cs: number;
	rs: number;
	col: number;
	ext?: number;
}

export function parseTableSectionRows(source: string): string[][] {
	const rows: string[][] = [];
	for (const raw of source.split('\n')) {
		const line = raw.trim();
		if (!line.startsWith('|')) continue;
		const inner = line.replace(/^\|/, '').replace(/\|$/, '');
		const cells = splitTableCells(inner);
		if (cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c))) continue;
		rows.push(cells);
	}
	return rows;
}

export function buildMergedTableGrid(rows: string[][]): TableSectionCell[][] {
    const grid: TableSectionCell[][] = [];
    rows.forEach((cells, r) => {
        const out: TableSectionCell[] = [];
        cells.forEach((text, c) => {
            if (text === '>') {
                const left = out[out.length - 1];
                if (left && left.col + left.cs === c) left.cs++;
                return;
            }
            if (text === '^') {
                for (let rr = r - 1; rr >= 0; rr--) {
                    const above = grid[rr]?.find(cell => cell.col <= c && c < cell.col + cell.cs && rr + cell.rs >= r);
                    if (above) { above.rs = Math.max(above.rs, r - rr + 1); break; }
                }
                return;
            }
            out.push({ text, cs: 1, rs: 1, col: c });
        });
        grid.push(out);
    });
    return grid;
}

/** Inverse of buildMergedTableGrid: emit markdown rows with `>` / `^` markers so
 *  in-place cell edits round-trip back into the dashboard file. */
export function serializeMergedGrid(grid: TableSectionCell[][]): string {
	let maxCols = 0;
	for (const row of grid) for (const cell of row) maxCols = Math.max(maxCols, cell.col + cell.cs);
	const lines: string[] = [];
	grid.forEach((row, r) => {
		const parts: string[] = [];
		for (let c = 0; c < maxCols; c++) {
			const start = row.find(cl => cl.col === c);
			if (start) {
				parts.push(start.text);
				continue;
			}
			const left = row.find(cl => cl.col < c && c < cl.col + cl.cs);
			if (left) {
				parts.push('>');
				continue;
			}
			let covered = false;
			for (let rr = r - 1; rr >= 0 && !covered; rr--) {
				const above = (grid[rr] ?? []).find(cl => cl.col <= c && c < cl.col + cl.cs);
				if (above && above.rs > r - rr) {
					parts.push('^');
					covered = true;
				}
			}
			if (!covered) parts.push('');
		}
		lines.push(`| ${parts.map(escapeTableCell).join(' | ')} |`);
		if (r === 0) {
			lines.push(`| ${new Array(maxCols).fill('---').join(' | ')} |`);
		}
	});
	return lines.join('\n');
}

export function gridToDenseRows(grid: TableSectionCell[][]): string[][] {
	let maxCols = 0;
	for (const row of grid) for (const cell of row) maxCols = Math.max(maxCols, cell.col + cell.cs);
	const dense: string[][] = [];
	for (let r = 0; r < grid.length; r++) {
		const parts: string[] = [];
		for (let c = 0; c < maxCols; c++) {
			const start = (grid[r] ?? []).find((cl) => cl.col === c);
			if (start) {
				parts.push(start.text);
				continue;
			}
			const left = (grid[r] ?? []).find((cl) => cl.col < c && c < cl.col + cl.cs);
			if (left) {
				parts.push('>');
				continue;
			}
			let covered = false;
			for (let rr = r - 1; rr >= 0 && !covered; rr--) {
				const above = (grid[rr] ?? []).find((cl) => cl.col <= c && c < cl.col + cl.cs);
				if (above && above.rs > r - rr) {
					parts.push('^');
					covered = true;
				}
			}
			if (!covered) parts.push('');
		}
		dense.push(parts);
	}
	return dense;
}

export function serializeDenseRows(dense: string[][]): string {
	const lines: string[] = [];
	dense.forEach((row, r) => {
		lines.push(`| ${row.map(escapeTableCell).join(' | ')} |`);
		if (r === 0) {
			lines.push(`| ${new Array(row.length).fill('---').join(' | ')} |`);
		}
	});
	return lines.join('\n');
}

export function addTableRowAt(dense: string[][], r: number, grid: TableSectionCell[][]): string[][] {
	const cols = dense[0]?.length ?? 0;
	const newRow: string[] = [];
	for (let c = 0; c < cols; c++) {
		const mergedAbove = grid.slice(0, r + 1).some((row, rr) =>
            row.some(cell => cell.col <= c && c < cell.col + cell.cs && rr + cell.rs > r + 1));
        newRow.push(mergedAbove ? '^' : '');
	}
	const next = [...dense];
	next.splice(r + 1, 0, newRow);
	return next;
}

export function deleteTableRowAt(dense: string[][], r: number): string[][] {
	if (r <= 1) return dense;
	const next = [...dense];
	const row = next[r];
	if (!row) return dense;
	const below = next[r + 1];
	if (below) {
		for (let c = 0; c < row.length; c++) {
			if (row[c] !== '^' && below[c] === '^') {
				below[c] = row[c] ?? '';
			}
		}
	}
	next.splice(r, 1);
	return next;
}

export function insertTableColumnAt(dense: string[][], c: number): string[][] {
	const cols = dense[0]?.length ?? 0;
	if (c < 0 || c > cols) return dense;
	return dense.map((row) => {
		let marker = '';
		if (c === cols) {
			const left = c > 0 ? row[c - 1] : undefined;
			if (left === '>' || left === '^') marker = left;
		} else {
			const cur = row[c];
			if (cur === '>' || cur === '^') marker = cur;
		}
		const next = [...row];
		next.splice(c, 0, marker);
		return next;
	});
}

export function deleteTableColumnAt(dense: string[][], c: number): string[][] {
	const cols = dense[0]?.length ?? 0;
	if (c < 0 || c >= cols) return dense;
	return dense.map((row) => {
		const removed = row[c];
		const next = [...row];
		next.splice(c, 1);
		if (removed !== '>' && removed !== '^' && next[c] === '>') {
			next[c] = removed ?? '';
		}
		return next;
	});
}

