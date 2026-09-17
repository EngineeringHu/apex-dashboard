/**
 * Pure workspace-registry helpers — no Obsidian value imports, so the module
 * stays directly testable outside the plugin runtime (jiti).
 *
 * Convention: workspace paths are stored WITHOUT the leading '/' and WITHOUT
 * the '.md' extension, matching the `dashboardFile` settings convention.
 */

export interface WorkspaceRegistry {
	files: string[];
	names: string[];
	active: string;
}

/** Trim, strip a leading '/' and a trailing '.md' — the settings-path form.
    Non-string input normalizes to '' (callers treat that as absent). */
export function normalizeWorkspacePath(path: unknown): string {
	if (typeof path !== 'string') return '';
	let p = path.trim();
	if (p.startsWith('/')) p = p.slice(1);
	if (p.toLowerCase().endsWith('.md')) p = p.slice(0, -3);
	return p.trim();
}

/** Validate a raw saved registry: normalize and de-duplicate entries in order
    (first occurrence keeps its name), fall back to the active file (or
    'dashboard') when nothing survives, and guarantee the active file is
    listed. Names stay index-aligned through de-duplication. */
export function migrateWorkspaces(raw: Record<string, unknown>): WorkspaceRegistry {
	const active = normalizeWorkspacePath(raw.dashboardFile) || 'dashboard';
	const rawNames = Array.isArray(raw.workspaceNames) ? raw.workspaceNames : [];
	const rawFiles = Array.isArray(raw.workspaceFiles) ? raw.workspaceFiles : [];
	const files: string[] = [];
	const names: string[] = [];
	for (let i = 0; i < rawFiles.length; i++) {
		const p = normalizeWorkspacePath(rawFiles[i]);
		if (!p || files.includes(p)) continue;
		files.push(p);
		names.push(typeof rawNames[i] === 'string' ? rawNames[i] as string : '');
	}
	if (!files.includes(active)) {
		files.push(active);
		names.push('');
	}
	return { files, names, active };
}

/** Pad/truncate a names array so it is index-aligned with `files`. */
export function alignWorkspaceNames(files: string[], names: unknown): string[] {
	const raw = Array.isArray(names) ? names : [];
	return files.map((_, i) => (typeof raw[i] === 'string' ? raw[i] : ''));
}

/** Drop non-active entries whose file no longer exists. The active entry is
    never pruned (findOrCreateFile() recreates it), so the result is never
    empty. `exists` receives the extensionless path. */
export function pruneMissingWorkspaces(
	files: string[],
	names: string[],
	active: string,
	exists: (path: string) => boolean,
): WorkspaceRegistry {
	const keptFiles: string[] = [];
	const keptNames: string[] = [];
	for (let i = 0; i < files.length; i++) {
		const p = files[i]!;
		if (p !== active && !exists(p)) continue;
		keptFiles.push(p);
		keptNames.push(names[i] ?? '');
	}
	if (keptFiles.length === 0) return { files: [active], names: [''], active };
	return { files: keptFiles, names: keptNames, active };
}

/** Keep only filesystem-safe characters; CJK/emoji-only names yield ''. */
export function slugifyWorkspaceName(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, '');
}

/** Next free workspace path, placed in the same folder as the first registry
    entry: `<dir>/<slug>` when free, else `<dir>/<slug>-<n>` on collision.
    CJK/emoji-only names yield an empty slug and fall back to auto-numbered
    `<base>-<n>` siblings of the first workspace. `exists` receives the
    extensionless path. */
export function nextWorkspacePath(
	existingFiles: string[],
	preferredName: string,
	exists: (path: string) => boolean,
): string {
	const first = normalizeWorkspacePath(existingFiles[0]) || 'dashboard';
	const slash = first.lastIndexOf('/');
	const dir = slash >= 0 ? first.slice(0, slash + 1) : '';
	const base = (slash >= 0 ? first.slice(slash + 1) : first) || 'dashboard';
	const slug = slugifyWorkspaceName(preferredName.trim());
	if (slug) {
		if (!exists(dir + slug)) return dir + slug;
		for (let n = 2; n < 100; n++) {
			const candidate = `${dir}${slug}-${n}`;
			if (!exists(candidate)) return candidate;
		}
	}
	for (let n = 2; n < 100; n++) {
		const candidate = `${dir}${base}-${n}`;
		if (!exists(candidate)) return candidate;
	}
	return `${dir}${base}-${Date.now()}`;
}

/** Per-workspace safety-copy filename. The dot separator keeps prunes
    independent in the shared backup dir: a 'dashboard.' prefix can never match
    a 'dashboard-2.<ts>.md' file. */
export function workspaceBackupName(base: string, ts: string): string {
	return `${base}.${ts}.md`;
}

// --- Folder mode ----------------------------------------------------------
// Folder mode points the banner switcher at ONE folder: every Markdown file
// directly inside it becomes a selectable workspace, and the + button creates
// a new empty weekly board there. An empty folder value turns it off.

/** Normalize the workspace-folder setting: trim, strip leading/trailing '/'.
    Non-string input and '' normalize to '' (folder mode off). */
export function normalizeWorkspaceFolder(folder: unknown): string {
	if (typeof folder !== 'string') return '';
	let f = folder.trim();
	if (f.startsWith('/')) f = f.slice(1);
	while (f.endsWith('/')) f = f.slice(0, -1);
	return f;
}

/** Whether an extensionless workspace path sits inside `folder` (already
    normalized, non-empty). */
export function isUnderWorkspaceFolder(path: string, folder: string): boolean {
	if (!folder) return false;
	return path === folder || path.startsWith(`${folder}/`);
}

/** File-name part of an extensionless workspace path ('a/b' -> 'b'). */
export function workspaceFileBaseName(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash >= 0 ? path.slice(slash + 1) : path;
}

/** Strip filesystem-unsafe characters from a preferred file name. CJK and
    most Unicode survive; only path separators, Windows-forbidden characters
    and control characters are removed. */
export function sanitizeWorkspaceFileBase(name: string): string {
	const forbidden = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);
	let out = '';
	for (const ch of name) {
		const code = ch.codePointAt(0) ?? 0;
		if (forbidden.has(ch) || code < 32) continue;
		out += ch;
	}
	return out.replace(/\s+/g, ' ').trim();
}

/** Next free file path inside `folder`: `<folder>/<base>` when free, else
    `<folder>/<base>-<n>` on collision. Auto-numbered fallback when the
    preferred name sanitizes to empty. `exists` receives the extensionless
    path; `existingCount` seeds the auto-numbered fallback. */
export function nextFolderWorkspacePath(
	folder: string,
	preferredName: string,
	existingCount: number,
	exists: (path: string) => boolean,
): string {
	const base = sanitizeWorkspaceFileBase(preferredName);
	if (base) {
		if (!exists(`${folder}/${base}`)) return `${folder}/${base}`;
		for (let n = 2; n < 100; n++) {
			const candidate = `${folder}/${base}-${n}`;
			if (!exists(candidate)) return candidate;
		}
	}
	const auto = `week-${existingCount + 1}`;
	if (!exists(`${folder}/${auto}`)) return `${folder}/${auto}`;
	return `${folder}/week-${Date.now()}`;
}
