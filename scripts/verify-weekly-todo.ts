import assert from 'node:assert/strict';
import { parse, serialize, generateEmptyWeeklyMarkdown } from '../src/parser';
import { SyncEngine } from '../src/sync';
import { DEFAULT_SETTINGS, type DashboardData } from '../src/types';
import { insertTableTodo, parseTableSectionRows, buildMergedTableGrid, serializeMergedGrid, gridToDenseRows, addTableRowAt, deleteTableRowAt, deleteTableColumnAt, serializeDenseRows } from '../src/table-model';

async function main() {
    const initial = parse(generateEmptyWeeklyMarkdown());
    const tableIndex = initial.columns.findIndex(c => c.sectionType === 'table');
    const original = initial.columns[tableIndex]!;
    assert.equal(original.cards.length, 0, 'legacy table must not become a phantom card');
    const dense = parseTableSectionRows(original.tableContent!);
    dense[2]![4] = '- [ ] A [[日记/2026-10-09|日记]]<br>[x] B';
    const seeded = { ...original, tableContent: serializeDenseRows(dense) };
    let column = insertTableTodo(seeded, 2, 4, 'card-src', '待办事项');
    column = insertTableTodo(column, 3, 5, 'card-dest', '待办事项');
    assert.equal(column.cards.length, 2);
    assert.equal(column.cards[0]!.tasks[0]!.text, 'A [[日记/2026-10-09|日记]]');
    assert.equal(column.cards[0]!.tasks[1]!.checked, true);
    assert.equal(insertTableTodo(column, 2, 4, 'ignored', '重复'), column, 'one card per cell');
    column.cards[0]!.tasks[0] = {
        text: 'parent', checked: false, collapsed: true, reminder: '2026-10-09 18:00', dailyNote: '日记/2026-10-09.md',
        children: [{ text: 'child', checked: true, children: [{ text: 'grandchild', checked: true, dailyNote: '日记/2026-10-10.md' }] }],
    };
    initial.columns[tableIndex] = column;
    const reload = parse(serialize(initial));
    const source = reload.columns[tableIndex]!.cards[0]!;
    assert.equal(source.tasks[0]!.dailyNote, '日记/2026-10-09.md');
    assert.equal(source.tasks[0]!.reminder, '2026-10-09 18:00');
    assert.equal(source.tasks[0]!.collapsed, true);
    assert.equal(source.tasks[0]!.children?.[0]?.children?.[0]?.dailyNote, '日记/2026-10-10.md');
    assert.ok(!reload.columns[tableIndex]!.tableContent!.includes('###'));
    assert.equal(serialize(parse(serialize(reload))), serialize(reload), 'stable repeated save/reload');

    let saved: DashboardData = reload;
    const engine = new SyncEngine({} as any, DEFAULT_SETTINGS);
    engine.initMemory(reload, async data => { saved = parse(serialize(data)); });
    await engine.moveTaskToCard('card-src', [0], 'missing-card', [0], 'before');
    assert.equal(engine.getData()!.columns[tableIndex]!.cards[0]!.tasks.length, 2, 'invalid destination never loses task');
    // Ctrl-copy into an empty card, before/after a task, and nested under a task.
    for (const mode of ['before', 'after', 'nest'] as const) {
        const copyEngine = new SyncEngine({} as any, DEFAULT_SETTINGS);
        let persisted = reload;
        copyEngine.initMemory(parse(serialize(reload)), async data => { persisted = parse(serialize(data)); });
        await copyEngine.moveTaskToCard('card-src', [0], 'card-dest', [0], 'before', true);
        const originalTask = copyEngine.getData()!.columns[tableIndex]!.cards[0]!.tasks[0]!;
        const copiedTask = copyEngine.getData()!.columns[tableIndex]!.cards[1]!.tasks[0]!;
        const content = (task: any): any => {
            const { syncInstanceId, ...rest } = task;
            return { ...rest, ...(task.children ? { children: task.children.map(content) } : {}) };
        };
        assert.deepEqual(content(copiedTask), content(originalTask), 'linked copy preserves shared content');
        assert.notEqual(copiedTask.syncInstanceId, originalTask.syncInstanceId, 'each position has its own identity');
        assert.notEqual(copiedTask, originalTask);
        assert.notEqual(copiedTask.children![0], originalTask.children![0], 'subtasks are independent objects');
        assert.equal(persisted.columns[tableIndex]!.cards[0]!.tasks.length, 2, 'source remains after save/reload');
        await copyEngine.moveTaskToCard('card-src', [1], 'card-dest', [0], mode, true);
        const dest = persisted.columns[tableIndex]!.cards[1]!.tasks;
        assert.equal(mode === 'nest' ? dest[0]!.children!.at(-1)!.text : dest[mode === 'before' ? 0 : 1]!.text, 'B');
        await copyEngine.editTask('card-dest', mode === 'before' ? [1, 0] : [0, 0], 'edited child');
        assert.equal(copyEngine.getData()!.columns[tableIndex]!.cards[0]!.tasks[0]!.children![0]!.text, 'edited child', 'linked child edit synchronizes back to source');
        const beforeInvalid = serialize(copyEngine.getData()!);
        await copyEngine.moveTaskToCard('card-src', [0], 'missing', [0], 'before', true);
        assert.equal(serialize(copyEngine.getData()!), beforeInvalid, 'invalid copy destination does not change data');
    }
    await engine.moveTaskToCard('card-src', [0], 'card-dest', [0], 'before');
    assert.equal(saved.columns[tableIndex]!.cards[0]!.tasks.length, 1);
    const moved = saved.columns[tableIndex]!.cards[1]!.tasks[0]!;
    assert.equal(moved.dailyNote, '日记/2026-10-09.md');
    assert.equal(moved.children?.[0]?.children?.[0]?.text, 'grandchild');
    await engine.setTaskDailyNote('card-dest', [0], '日记/别的日记.md', 'parent');
    assert.equal(saved.columns[tableIndex]!.cards[1]!.tasks[0]!.dailyNote, '日记/别的日记.md');
    await engine.setTaskDailyNote('card-dest', [0], 'wrong.md', 'stale');
    assert.equal(engine.getData()!.columns[tableIndex]!.cards[1]!.tasks[0]!.dailyNote, '日记/别的日记.md');
    await engine.setTaskDailyNote('card-dest', [0], undefined, 'parent');
    assert.equal(saved.columns[tableIndex]!.cards[1]!.tasks[0]!.dailyNote, undefined);
    await engine.moveTaskToCard('card-src', [0], 'card-dest', [99, 0], 'before');
    assert.equal(engine.getData()!.columns[tableIndex]!.cards[0]!.tasks.length, 1, 'missing nested destination keeps task');
    await engine.moveTaskToCard('card-src', [0], 'card-dest', [0], 'nest');
    assert.equal(saved.columns[tableIndex]!.cards[0]!.tasks.length, 0);
    assert.equal(saved.columns[tableIndex]!.cards[1]!.tasks[0]!.children!.length, 2);
    await engine.moveTaskToCard('card-dest', [0, 1], 'card-src', [0], 'before');
    assert.equal(saved.columns[tableIndex]!.cards[0]!.tasks[0]!.text, 'B');
    await engine.deleteCard('card-src');
    assert.ok(!saved.columns[tableIndex]!.tableContent!.includes('card-src'));

    const mergedRows = [['a','>','b'],['^','^','c'],['^','^','d']];
    const grid = buildMergedTableGrid(mergedRows);
    assert.equal(grid[0]![0]!.cs, 2);
    assert.equal(grid[0]![0]!.rs, 3);
    assert.equal(grid[1]![0]!.col, 2, 'horizontal + vertical merge retains following column');
    assert.deepEqual(parseTableSectionRows(serializeMergedGrid(grid)), mergedRows);
    const expanded = addTableRowAt(gridToDenseRows(grid), 1, grid);
    assert.deepEqual(expanded[2], ['^','^','']);
    const deleted = deleteTableRowAt(parseTableSectionRows(column.tableContent!), 3);
    const removedColumn = deleteTableColumnAt(deleted, 4);
    await engine.updateTableContent(column.name, serializeDenseRows(removedColumn));
    assert.equal(saved.columns[tableIndex]!.cards.length, 1, 'deleting rows/columns retains card data');
    const pipeRows = [['header','notes'], ['role','literal | separator [[folder/note|alias]]']];
    assert.deepEqual(parseTableSectionRows(serializeDenseRows(pipeRows)), pipeRows);
    console.log('weekly todo: migration, merged cells, card round-trip, subtree moves, diary links, stale drops and deletion passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
