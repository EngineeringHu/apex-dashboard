import { strict as assert } from 'node:assert';
import { backupsToPrune, pruneRollingBackups, ROLLING_BACKUP_DIR } from '../src/rolling-backup-retention';
import { workspaceBackupName } from '../src/workspace-registry';

function backup(name: string, second: number): string {
	const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString().replace(/[:.]/g, '-');
	return `${ROLLING_BACKUP_DIR}/${workspaceBackupName(name, stamp)}`;
}

async function main(): Promise<void> {
	const ordinary = [
		...Array.from({ length: 5 }, (_, i) => backup('dashboard', i)),
		...Array.from({ length: 4 }, (_, i) => backup('dashboard-2', i)),
		'.dashboard-backup/readme.md',
		'.dashboard-backup/dashboard.other.md',
		'.dashboard-backup/nested/2026-01-01T00-00-00-000Z.md',
	];
	const firstPrune = backupsToPrune(ordinary);
	assert.deepEqual(firstPrune.slice().sort(), [
		backup('dashboard', 0), backup('dashboard', 1), backup('dashboard', 2),
		backup('dashboard-2', 0), backup('dashboard-2', 1),
	].sort(), 'keep two recent copies per exact name and leave unrelated files alone');

	const manyNames = Array.from({ length: 20 }, (_, n) => [backup(`week-${n}`, n), backup(`week-${n}`, n + 40)]).flat();
	const globalPrune = new Set(backupsToPrune(manyNames));
	assert.equal(globalPrune.size, 35, 'whole folder has at most five recognized backups');
	for (let n = 0; n < 20; n++) {
		assert.equal(globalPrune.has(backup(`week-${n}`, n + 40)), n < 15, 'newest copies from the five most recent names win');
		assert.equal(globalPrune.has(backup(`week-${n}`, n)), true, 'older copies give way to newer names');
	}
	const fewNames = ['a', 'b', 'c'].flatMap((name, n) => [backup(name, n), backup(name, n + 20), backup(name, n + 40)]);
	const fewPrune = new Set(backupsToPrune(fewNames));
	assert.equal(fewPrune.size, 4);
	for (let n = 0; n < 3; n++) assert.equal(fewPrune.has(backup(['a', 'b', 'c'][n]!, n + 40)), false, 'each name keeps its newest copy when there is room');
	assert.equal(fewPrune.has(backup('a', 20)), true, 'oldest second copy is removed at the global limit');
	const overThirtyNames = Array.from({ length: 35 }, (_, n) => backup(`old-${n}`, n));
	assert.deepEqual(backupsToPrune(overThirtyNames).sort(), overThirtyNames.slice(0, 30).sort(), 'global cap applies even with many names');

	const files = new Set(ordinary);
	const removed: string[] = [];
	const adapter = {
		exists: async (path: string) => path === ROLLING_BACKUP_DIR,
		list: async () => ({ files: [...files], folders: [] }),
		remove: async (path: string) => { assert.ok(files.delete(path)); removed.push(path); },
	};
	await pruneRollingBackups(adapter);
	assert.deepEqual(removed.slice().sort(), firstPrune.slice().sort(), 'startup cleanup removes only selected copies');
	assert.equal(files.size, ordinary.length - firstPrune.length);
	await pruneRollingBackups(adapter);
	assert.equal(removed.length, firstPrune.length, 'repeating cleanup is safe');

	let listed = false;
	await pruneRollingBackups({
		exists: async () => false,
		list: async () => { listed = true; return { files: [], folders: [] }; },
		remove: async () => { throw Error('unexpected removal'); },
	});
	assert.equal(listed, false, 'missing folder is left alone');
	console.log('verify-rolling-backup: per-name, global, unknown-file and adapter checks OK');
}

void main();
