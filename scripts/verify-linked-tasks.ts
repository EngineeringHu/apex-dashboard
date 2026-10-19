import assert from 'node:assert/strict';
import { parse, serialize, generateEmptyWeeklyMarkdown } from '../src/parser';
import { SyncEngine } from '../src/sync';
import { DEFAULT_SETTINGS, type DashboardData, type TaskItem } from '../src/types';
import { insertTableTodo } from '../src/table-model';
import * as cryptoFormat from '../src/secure/format.mjs';

Object.assign(globalThis, { window: globalThis });
const clone = <T>(value: T): T => structuredClone(value);
function fixture() {
    const data = parse(generateEmptyWeeklyMarkdown());
    let table = data.columns.find(c => c.sectionType === 'table')!;
    for (const [index,id] of ['a','b','c'].entries()) table = insertTableTodo(table, 2, index + 4, id, id);
    table.cards[0]!.tasks = [{
        text: 'parent', checked: false, taskType: 'temporary', collapsed: true, reminder: '2026-10-10 18:00', dailyNote: '日记/2026-10-10.md',
        children: [
            { text: 'first', checked: false, children: [{ text: 'grandchild', checked: false }] },
            { text: 'second', checked: false },
        ],
    }];
    data.columns = [table];
    return data;
}
function setup(data = fixture()) {
    const e = new SyncEngine({} as any, DEFAULT_SETTINGS);
    let disk = serialize(data), writes = 0;
    e.initMemory(data, async next => { disk = serialize(next); writes++; });
    const tasks = (id: string): TaskItem[] => e.getData()!.columns.flatMap(c => c.cards).find(c => c.id === id)!.tasks;
    const reload = () => { e.initMemory(parse(disk), async next => { disk = serialize(next); writes++; }); };
    return { e, tasks, reload, disk: () => disk, writes: () => writes };
}
async function main() {
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        assert.equal(f.writes(), 1, 'one write creates both linked instances');
        assert.equal(f.tasks('a')[0]!.syncId, f.tasks('b')[0]!.syncId);
        assert.notEqual(f.tasks('a')[0]!.syncInstanceId, f.tasks('b')[0]!.syncInstanceId);
        f.reload();
        await f.e.editTask('b', [0], 'edited in B');
        assert.equal(f.tasks('a')[0]!.text, 'edited in B');
        await f.e.editTask('a', [0,0,0], 'edited grandchild');
        assert.equal(f.tasks('b')[0]!.children![0]!.children![0]!.text, 'edited grandchild');
        await f.e.editTaskReminder('b', [0], undefined);
        assert.equal(f.tasks('a')[0]!.reminder, undefined);
        await f.e.setTaskDailyNote('a', [0], '日记/新的.md', 'edited in B');
        assert.equal(f.tasks('b')[0]!.dailyNote, '日记/新的.md');
        await f.e.setTaskDailyNote('b', [0], undefined, 'edited in B');
        assert.equal(f.tasks('a')[0]!.dailyNote, undefined);
        await f.e.toggleTask('a', [0], true);
        assert.equal(f.tasks('b')[0]!.children![0]!.children![0]!.checked, true);
        await f.e.toggleTask('b', [0,0,0], false);
        assert.equal(f.tasks('a')[0]!.checked, false, 'all corresponding parents recalculate completion');
        assert.equal(f.tasks('a')[0]!.children![0]!.checked, false);
        assert.equal(f.tasks('b')[0]!.checked, false);
        f.e.toggleCollapseTaskQuiet('b', [0]);
        await f.e.flushPending();
        assert.equal(f.tasks('a')[0]!.collapsed, true);
        assert.equal(f.tasks('b')[0]!.collapsed, false);
        await f.e.editTask('a', [0], 'still linked');
        assert.equal(f.tasks('b')[0]!.collapsed, false, 'sync does not reset local collapse');
        f.reload();
        assert.equal(f.tasks('a')[0]!.text, f.tasks('b')[0]!.text);
        assert.ok(f.disk().includes('apex-sync:'), 'links persist in Markdown');
    }
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        await f.e.addTask('a', 'new child', [0]);
        assert.equal(f.tasks('b')[0]!.children!.length, 3);
        assert.equal(f.tasks('b')[0]!.children![2]!.text, 'new child');
        await f.e.deleteTask('b', [0,1]);
        assert.deepEqual(f.tasks('a')[0]!.children!.map(t => t.text), ['first','new child']);
        await f.e.reorderTask('a', [0,1], [0,0], true);
        assert.deepEqual(f.tasks('b')[0]!.children!.map(t => t.text), ['new child','first']);
        await f.e.nestTaskInto('a', [0,0], [0,1]);
        assert.equal(f.tasks('b')[0]!.children![0]!.children![1]!.text, 'new child');
        await f.e.moveTaskToCard('a', [0,0], 'c', [0], 'before');
        assert.equal(f.tasks('a')[0]!.children!.length, 0);
        assert.equal(f.tasks('b')[0]!.children!.length, 0, 'moving a subtask out synchronizes the parent structure');
        assert.equal(f.tasks('c')[0]!.children!.length, 2, 'moved subtree survives');
        await f.e.moveTaskToCard('a', [0], 'c', [0], 'before');
        assert.equal(f.tasks('a').length, 0, 'only moved root position changes');
        assert.equal(f.tasks('b').length, 1, 'other root instance remains');
        await f.e.deleteTask('c', [0]);
        assert.equal(f.tasks('b').length, 1, 'deleting one root does not delete its peer');
    }
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        await f.e.moveTaskToCard('b', [0], 'c', [0], 'before', true);
        await f.e.unlinkTask('b', [0]);
        assert.equal(f.tasks('b')[0]!.syncId, undefined);
        assert.equal(f.tasks('b')[0]!.children![0]!.syncId, undefined);
        await f.e.editTask('b', [0,0], 'independent');
        assert.equal(f.tasks('a')[0]!.children![0]!.text, 'first');
        await f.e.editTask('a', [0,0], 'shared');
        assert.equal(f.tasks('c')[0]!.children![0]!.text, 'shared');
        assert.equal(f.tasks('b')[0]!.children![0]!.text, 'independent');
        f.reload();
        assert.equal(f.tasks('b')[0]!.syncId, undefined, 'unlink persists after reload');
        await f.e.unlinkTask('c', [0,0]);
        assert.equal(f.tasks('c')[0]!.syncId, undefined, 'unlink inside a linked tree detaches the enclosing tree here');
        await f.e.editTask('a', [0], 'A only');
        assert.equal(f.tasks('c')[0]!.text, 'parent');
    }
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        const before = f.disk();
        await f.e.moveTaskToCard('a', [0], 'b', [0,0], 'nest', true);
        assert.equal(f.disk(), before, 'linked cycle copy is rejected without data loss');
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'nest');
        assert.equal(f.disk(), before, 'linked cycle move is rejected without removing source');
        await f.e.moveTaskToCard('a', [0,0], 'c', [0], 'before', true);
        await f.e.editTask('c', [0,0], 'shared detached grandchild');
        assert.equal(f.tasks('a')[0]!.children![0]!.children![0]!.text, 'shared detached grandchild');
        assert.equal(f.tasks('b')[0]!.children![0]!.children![0]!.text, 'shared detached grandchild');
    }
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        const data = clone(f.e.getData()!);
        const other = clone(data.columns[0]!);
        other.name = 'Other table';
        for (const c of other.cards) c.id = 'other-' + c.id;
        data.columns.push(other);
        const scoped = setup(data);
        await scoped.e.editTask('a', [0], 'local to one table');
        assert.equal(scoped.tasks('other-a')[0]!.text, 'parent', 'same IDs in another table are outside scope');
        const legacy = setup();
        legacy.e.getData()!.columns[0]!.cards[1]!.tasks = clone(legacy.tasks('a'));
        await legacy.e.editTask('a', [0], 'legacy independent');
        assert.equal(legacy.tasks('b')[0]!.text, 'parent', 'old copies are not linked by equal text');
    }
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        await f.e.moveTaskToCard('b', [0], 'a', [1], 'before');
        assert.equal(f.tasks('a').length, 2);
        await f.e.editTask('a', [1], 'same card, different occurrence');
        assert.equal(f.tasks('a')[0]!.text, f.tasks('a')[1]!.text);
        await f.e.unlinkTask('a', [1]);
        await f.e.editTask('a', [0], 'first only');
        assert.equal(f.tasks('a')[1]!.text, 'same card, different occurrence');
    }
    {
        const f = setup();
        await f.e.moveTaskToCard('a', [0], 'b', [0], 'before', true);
        await f.e.toggleTask('a', [0,1], true);
        await f.e.archiveTasks(f.e.getData()!.columns[0]!.name);
        assert.equal(f.tasks('a')[0]!.children!.length, 1);
        assert.equal(f.tasks('b')[0]!.children!.length, 1);
        const password = 'Synthetic-linked-tasks-only';
        const recipient = await cryptoFormat.createRecipient(password);
        const envelope = await cryptoFormat.createPublic(f.disk(), 'Synthetic linked tasks', recipient);
        const cipher = cryptoFormat.stringify(envelope);
        assert.ok(!cipher.includes(f.tasks('a')[0]!.syncId!), 'shared identities remain inside ciphertext');
        const root = await cryptoFormat.resolveRoot(password, envelope);
        const opened = await cryptoFormat.openAll(envelope, root);
        const restored = setup(parse(opened.markdown));
        assert.equal(restored.tasks('a')[0]!.taskType, 'temporary', 'task type survives encryption');
        assert.equal(restored.tasks('b')[0]!.taskType, 'temporary', 'linked type survives encryption');
        await restored.e.editTask('b', [0,0], 'edited after decrypt');
        assert.equal(restored.tasks('a')[0]!.children![0]!.text, 'edited after decrypt');
    }
    console.log('linked tasks: bidirectional fields, nested completion, structures, local positions/collapse/delete, unlink, reload, scope and cycle safety passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
