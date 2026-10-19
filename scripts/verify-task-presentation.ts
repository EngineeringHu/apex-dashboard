import assert from 'node:assert/strict';
import { parse, serialize, generateEmptyWeeklyMarkdown } from '../src/parser';
import { scanFileTasks } from '../src/alltasks-scan';
import { taskType, readTaskMetadataSuffix } from '../src/task-metadata';
import { sanitizeTaskStyles, resolveTaskAppearance, linkedTaskColor } from '../src/task-presentation';
import { SyncEngine } from '../src/sync';
import { insertTableTodo } from '../src/table-model';
import { DEFAULT_SETTINGS, type TaskItem } from '../src/types';

Object.assign(globalThis, { window: globalThis });
const defaults = sanitizeTaskStyles(undefined);
assert.equal(taskType(undefined), 'planned');
assert.equal(taskType('invalid'), 'planned');
assert.equal(readTaskMetadataSuffix('text <!--apex-task-type:future-->').text, 'text <!--apex-task-type:future-->');
const malicious = sanitizeTaskStyles({ incomplete: { enabled: false, color: 'url(https://example.invalid)' }, types: null, linked: { palette: ['#FF00FF', '<style>'] } });
assert.equal(malicious.incomplete.enabled, false);
assert.equal(malicious.incomplete.color, defaults.incomplete.color);
assert.equal(malicious.linked.palette[0], '#ff00ff');
assert.equal(malicious.linked.palette.length, defaults.linked.palette.length);
malicious.linked.palette[1] = '#000000';
assert.notEqual(sanitizeTaskStyles(undefined).linked.palette[1], '#000000');

for (const checked of [false, true]) for (const type of ['planned', 'temporary'] as const)
    for (const linked of [false, true]) for (const types of [false, true]) for (const incomplete of [false, true]) {
        const settings = sanitizeTaskStyles({ ...defaults, linked: { ...defaults.linked, enabled: linked },
            types: { ...defaults.types, enabled: types }, incomplete: { ...defaults.incomplete, enabled: incomplete } });
        const appearance = resolveTaskAppearance({ checked, taskType: type, syncId: 'linked-group' }, settings);
        assert.equal(appearance.source, checked ? 'completed' : linked ? 'linked' : types ? 'type' : incomplete ? 'incomplete' : 'theme');
        assert.equal(appearance.pendingAccent, !checked && incomplete ? settings.incomplete.color : undefined);
        assert.equal(appearance.typeColor, types ? settings.types[type] : undefined);
        if (checked) assert.equal(appearance.background, undefined);
    }
const original = resolveTaskAppearance({ checked: false, taskType: 'temporary', syncId: 'same-task' }, defaults);
assert.equal(original.background, resolveTaskAppearance({ checked: false, taskType: 'planned', syncId: 'same-task' }, defaults).background);
assert.equal(original.background, linkedTaskColor('same-task', sanitizeTaskStyles(defaults).linked.palette));
assert.equal(resolveTaskAppearance({ checked: false }, defaults).source, 'type');

async function main() {
    const data = parse(generateEmptyWeeklyMarkdown());
    let table = data.columns.find(column => column.sectionType === 'table')!;
    table = insertTableTodo(table, 2, 4, 'a', 'A');
    table = insertTableTodo(table, 2, 5, 'b', 'B');
    table.cards[0]!.tasks = [{ text: '合成任务', checked: false, reminder: '2026-10-17 09:30',
        dailyNote: '日记/合成.md', collapsed: true, taskType: 'temporary',
        children: [{ text: '计划子任务', checked: true, taskType: 'planned' }, { text: '旧任务', checked: false }] }];
    data.columns = [table];
    let disk = '';
    const engine = new SyncEngine({} as any, DEFAULT_SETTINGS);
    const tasks = (id: string): TaskItem[] => engine.getData()!.columns[0]!.cards.find(card => card.id === id)!.tasks;
    const save = async (next: typeof data) => { disk = serialize(next); };
    engine.initMemory(data, save);
    await engine.moveTaskToCard('a', [0], 'b', [0], 'before', true);
    assert.equal(tasks('b')[0]!.taskType, 'temporary');
    await engine.setTaskType('b', [0], 'planned');
    assert.equal(tasks('a')[0]!.taskType, 'planned', 'type synchronizes through linked copies');
    await engine.setTaskType('a', [0, 1], 'temporary');
    assert.equal(tasks('b')[0]!.children![1]!.taskType, 'temporary', 'subtask type synchronizes');
    engine.initMemory(parse(disk), save);
    assert.equal(tasks('b')[0]!.taskType, 'planned', 'type survives reload');
    assert.equal(tasks('b')[0]!.reminder, '2026-10-17 09:30');
    assert.equal(tasks('b')[0]!.dailyNote, '日记/合成.md');
    assert.equal(tasks('b')[0]!.collapsed, true);
    assert.ok(tasks('b')[0]!.syncId);
    assert.equal(tasks('b')[0]!.text, '合成任务');
    const scanned = scanFileTasks({ path: 'synthetic.md', stat: { mtime: 0, ctime: 0 } } as any, disk);
    assert.equal(scanned[0]!.taskType, 'planned');
    assert.equal(scanned[0]!.text, '合成任务', 'calendar and history do not display metadata');
    assert.equal(scanned[0]!.reminder, '2026-10-17 09:30');
    assert.ok(scanned[0]!.syncKey, 'history dedup remains available');
    await engine.unlinkTask('b', [0]);
    await engine.setTaskType('b', [0], 'temporary');
    assert.equal(tasks('a')[0]!.taskType, 'planned', 'unlinked types are independent');
    assert.equal(resolveTaskAppearance(tasks('b')[0]!, defaults).source, 'type');
    const legacy = parse(generateEmptyWeeklyMarkdown());
    assert.ok(!serialize(legacy).includes('apex-task-type:'), 'legacy notes are not bulk migrated');
    engine.clearMemory();
    console.log('task presentation: priority matrix, sanitization, stable identity colors, metadata, linked edits, reload and scanning passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
