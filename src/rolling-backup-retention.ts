/** Retention for the pre-write Markdown copies in the vault root. */
export const ROLLING_BACKUP_DIR = '.dashboard-backup';
export const MAX_BACKUPS_PER_NAME = 2;
export const MAX_BACKUPS_TOTAL = 5;

interface BackupSnapshot {
	path: string;
	name: string;
	stamp: string;
}

interface BackupListAdapter {
	exists(path: string): Promise<boolean>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
}

const BACKUP_NAME = /^(.+)\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.md$/;

function parseBackup(path: string): BackupSnapshot | null {
	const prefix = `${ROLLING_BACKUP_DIR}/`;
	if (!path.startsWith(prefix)) return null;
	const fileName = path.slice(prefix.length);
	if (fileName.includes('/')) return null;
	const match = BACKUP_NAME.exec(fileName);
	return match ? { path, name: match[1]!, stamp: match[2]! } : null;
}

function newestFirst(a: BackupSnapshot, b: BackupSnapshot): number {
	return b.stamp.localeCompare(a.stamp) || b.path.localeCompare(a.path);
}

/** Keep the newest copy of each name first, then fill remaining slots with
 * second copies. Unknown files are never selected for deletion. */
export function backupsToPrune(paths: readonly string[]): string[] {
	const byName = new Map<string, BackupSnapshot[]>();
	for (const path of paths) {
		const snapshot = parseBackup(path);
		if (!snapshot) continue;
		const group = byName.get(snapshot.name) ?? [];
		group.push(snapshot);
		byName.set(snapshot.name, group);
	}

	const newest: BackupSnapshot[] = [];
	const older: BackupSnapshot[] = [];
	const all: BackupSnapshot[] = [];
	for (const group of byName.values()) {
		group.sort(newestFirst);
		all.push(...group);
		newest.push(group[0]!);
		older.push(...group.slice(1, MAX_BACKUPS_PER_NAME));
	}

	const keep = new Set(newest.sort(newestFirst).slice(0, MAX_BACKUPS_TOTAL).map(snapshot => snapshot.path));
	const freeSlots = MAX_BACKUPS_TOTAL - keep.size;
	for (const snapshot of older.sort(newestFirst).slice(0, freeSlots)) keep.add(snapshot.path);
	return all.filter(snapshot => !keep.has(snapshot.path)).sort((a, b) => a.stamp.localeCompare(b.stamp)).map(snapshot => snapshot.path);
}

export async function pruneRollingBackups(adapter: BackupListAdapter): Promise<void> {
	if (!(await adapter.exists(ROLLING_BACKUP_DIR))) return;
	const listing = await adapter.list(ROLLING_BACKUP_DIR);
	for (const path of backupsToPrune(listing.files)) await adapter.remove(path);
}
