import { FileSystemAdapter, MarkdownView, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import { lstat, realpath, rmdir, utimes } from 'fs/promises';
import * as nodePath from 'path';
import type { SecureController } from './controller';
import { DashboardView, DASHBOARD_VIEW_TYPE } from '../view';
import { NotePopoverModal } from '../note-popover-modal';
import { invalidatePath as invalidateDql } from '../dql/page-builder';
import { invalidatePath as invalidateTasks } from '../alltasks-scan';
import { askPassword } from './dialogs';
import { freshId, envelope } from './runtime';
import { ProtectedIndexCleanup } from './index-cleanup';
import { DAILY_EXTENSION, DAILY_ROOT, registerDailyAccess } from './daily-access';

export const DAILY_MODE_FILE = '.apex-daily-mode.json';
export const DAILY_CHANGE_FILE = '.apex-daily-mode-change.json';
export const DAILY_STAGING = '.apex-daily-mode-staging';
type Entry = { source: string; target: string; before: string; after: string; index: number; mtime: number; ctime: number };
type Change = { version: 1; id: string; enabled: boolean; previous: string | null; entries: Entry[] };
type DailyDocument = { kind: 'daily'; version: 1; path: string; mtime: number; ctime: number };
type OpenedDaily = { markdown: string; payloads: Array<{ document?: DailyDocument }>; token: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const inDaily = (path: string) => path.startsWith(`${DAILY_ROOT}/`);

/** A manual snapshot conversion. Only ciphertext is ever written to staging. */
export class DailyEncryptionMode {
	enabled = false;
	busy = false;
	pending = false;
	private paths = new Set<string>();
	private guard: ProtectedIndexCleanup | null = null;
	constructor(private controller: SecureController) { registerDailyAccess(controller.plugin.app, this); }
	private get app() { return this.controller.plugin.app; }
	private get adapter() { return this.app.vault.adapter; }
	plainFiles(): TFile[] { return this.app.vault.getMarkdownFiles().filter(f => inDaily(f.path)); }
	encryptedFiles(): TFile[] { return this.app.vault.getFiles().filter(f => inDaily(f.path) && f.path.endsWith(DAILY_EXTENSION)); }
	counts(): { encrypted: number; plain: number } { return { encrypted: this.encryptedFiles().length, plain: this.plainFiles().length }; }
	affected(path: string): boolean { return this.paths.has(path) || (this.pending && !this.paths.size && inDaily(path)); }
	async load(): Promise<void> {
		if (await this.adapter.exists(DAILY_MODE_FILE)) {
			const state = JSON.parse(await this.adapter.read(DAILY_MODE_FILE)) as { version?: unknown; enabled?: unknown };
			if (state.version !== 1 || typeof state.enabled !== 'boolean') throw Error('日记加密开关配置无效');
			this.enabled = state.enabled;
		} else this.enabled = this.encryptedFiles().length > 0;
		this.pending = await this.adapter.exists(DAILY_CHANGE_FILE);
		if (this.pending) {
			try {
				const change = JSON.parse(await this.adapter.read(DAILY_CHANGE_FILE)) as Change;
				await this.validate(change);
				this.paths = new Set(change.entries.flatMap(e => [e.source, e.target]));
			} catch { this.paths.clear(); /* Keep the plugin loaded so recovery remains reachable. */ }
		}
	}
	announce(): void { if (this.pending) new Notice('日记加密切换尚未完成，请到 Apex 设置中继续切换。', 10000); }
	async assertReady(): Promise<void> {
		if (this.busy || this.pending || await this.adapter.exists(DAILY_CHANGE_FILE)) throw Error('日记加密切换尚未完成，请在设置中继续切换');
	}
	private async hash(value: string | Uint8Array): Promise<string> { return this.controller.crypto.call<string>('hash', { value }); }
	private bytes(text: string): Uint8Array { return encoder.encode(text); }
	private raw(bytes: Uint8Array): string {
		const raw = decoder.decode(bytes);
		if (this.bytes(raw).length !== bytes.length || !this.bytes(raw).every((b, i) => b === bytes[i])) throw Error('日记编码不是可往返的 UTF-8，原文件未更改');
		return raw;
	}
	private validPath(path: string): void {
		if (!inDaily(path) || path.includes('\\') || path.includes(':') || path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw Error('日记转换路径非法');
	}
	private async diskPath(path: string): Promise<string> {
		if (!(this.adapter instanceof FileSystemAdapter)) throw Error('日记加密需要桌面文件系统');
		const base = await realpath(this.adapter.getBasePath()); let current = base;
		for (const part of path.split('/')) {
			if (!part || part === '.' || part === '..' || part.includes(':') || part.includes('\\')) throw Error('转换路径越界');
			current = nodePath.join(current, part);
			try { if ((await lstat(current)).isSymbolicLink()) throw Error('转换路径不可包含符号链接或 junction'); }
			catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
		}
		if (nodePath.relative(base, current).startsWith('..') || nodePath.isAbsolute(nodePath.relative(base, current))) throw Error('转换路径越界');
		return current;
	}
	private async allDailyFiles(path = DAILY_ROOT): Promise<string[]> {
		if (!await this.adapter.exists(path)) return [];
		await this.diskPath(path);
		const { files, folders } = await this.adapter.list(path);
		const result = [...files];
		for (const folder of folders) result.push(...await this.allDailyFiles(folder));
		return result;
	}
	private async scan(strict = true): Promise<{ plain: TFile[]; cipher: TFile[] }> {
		const plain: TFile[] = [], cipher: TFile[] = [];
		for (const path of await this.allDailyFiles()) {
			this.validPath(path); await this.diskPath(path);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw Error(`日记文件尚未进入 Obsidian 索引，请稍后重试：${path}`);
			if (path.endsWith('.md')) plain.push(file);
			else if (path.endsWith(DAILY_EXTENSION)) cipher.push(file);
			else if (strict) throw Error(`日记目录含尚不支持加密的文件：${path}。请先移出目录再开启加密`);
		}
		const cipherPaths = new Set(cipher.map(f => f.path));
		for (const file of plain) if (cipherPaths.has(file.path.slice(0, -3) + DAILY_EXTENSION)) throw Error(`日记明文与密文同名冲突，请先将新建明文改名保存：${file.path}`);
		return { plain, cipher };
	}
	private async closeEditors(paths: Set<string>): Promise<void> {
		(document.activeElement as HTMLElement | null)?.blur();
		await NotePopoverModal.closeFiles(paths);
		await this.controller.lockAll();
		const leaves: WorkspaceLeaf[] = [];
		this.app.workspace.iterateAllLeaves(leaf => leaves.push(leaf));
		for (const leaf of leaves) {
			const view = leaf.view;
			if ('file' in view && view.file instanceof TFile && paths.has(view.file.path)) {
				if (view instanceof MarkdownView) await view.save();
				await leaf.setViewState({ type: 'empty' });
			} else if (view.getViewType() === DASHBOARD_VIEW_TYPE) {
				if (view instanceof DashboardView) await view.flushBeforeEncryption();
				await leaf.setViewState({ type: 'empty' });
			}
		}
	}
	private async validate(change: Change): Promise<void> {
		if (change.version !== 1 || !/^[0-9a-f-]{36}$/i.test(change.id) || typeof change.enabled !== 'boolean' || !Array.isArray(change.entries) || !(change.previous === null || typeof change.previous === 'string')) throw Error('日记转换恢复记录无效');
		const seen = new Set<string>();
		for (const [index, entry] of change.entries.entries()) {
			if (entry.index !== index || !Number.isFinite(entry.mtime) || !Number.isFinite(entry.ctime) || !/^[A-Za-z0-9+/]{43}=$/.test(entry.before) || !/^[A-Za-z0-9+/]{43}=$/.test(entry.after)) throw Error('日记转换记录不完整');
			for (const path of [entry.source, entry.target]) { this.validPath(path); if (seen.has(path)) throw Error('日记转换路径重复'); seen.add(path); await this.diskPath(path); }
			if (change.enabled ? entry.target !== entry.source.slice(0, -3) + DAILY_EXTENSION || !entry.source.endsWith('.md') : entry.target !== entry.source.slice(0, -DAILY_EXTENSION.length) + '.md' || !entry.source.endsWith(DAILY_EXTENSION)) throw Error('日记转换方向无效');
			await this.diskPath(this.stage(change, index));
		}
	}
	private stage(change: Change, index: number): string { return `${DAILY_STAGING}/${change.id}/${index}${DAILY_EXTENSION}`; }
	private async preflight(change: Change, outputs = false): Promise<void> {
		await this.validate(change);
		const state = await this.adapter.exists(DAILY_MODE_FILE) ? await this.adapter.read(DAILY_MODE_FILE) : null;
		if (state !== change.previous && state !== JSON.stringify({ version: 1, enabled: change.enabled }) + '\n') throw Error('日记加密开关配置被外部修改');
		for (const entry of change.entries) {
			if (outputs && !await this.adapter.exists(entry.target)) throw Error(`转换结果被移除：${entry.target}`);
			if (await this.adapter.exists(entry.source)) {
				if (await this.hash(new Uint8Array(await this.adapter.readBinary(entry.source))) !== entry.before) throw Error(`日记被外部修改，原文件保留：${entry.source}`);
			} else if (!await this.adapter.exists(entry.target)) throw Error(`原文件和结果均缺失：${entry.source}`);
			if (await this.adapter.exists(entry.target) && await this.hash(new Uint8Array(await this.adapter.readBinary(entry.target))) !== entry.after) throw Error(`目标已有其他内容，未覆盖：${entry.target}`);
			const staged = await this.adapter.read(this.stage(change, entry.index)); envelope(staged);
			if (await this.hash(this.bytes(staged)) !== (change.enabled ? entry.after : entry.before)) throw Error('日记转换暂存文件已改变');
		}
	}
	private async publish(path: string, text: string, hash: string): Promise<void> {
		await this.diskPath(path);
		if (!await this.adapter.exists(path)) await this.app.vault.create(path, text);
		if (await this.hash(new Uint8Array(await this.adapter.readBinary(path))) !== hash) throw Error(`日记写入校验失败，原文件保留：${path}`);
	}
	private async opened(text: string, password: string, entry: Entry): Promise<string> {
		const value = await this.controller.crypto.call<OpenedDaily>('open-all', { text, password });
		try {
			const doc = value.payloads?.[0]?.document;
			if (value.payloads?.length !== 1 || doc?.version !== 1 || doc?.kind !== 'daily' || doc.path !== entry.target || doc.mtime !== entry.mtime || doc.ctime !== entry.ctime) throw Error(`日记密文路径或版本不匹配：${entry.source}`);
			return value.markdown;
		} finally { await this.controller.crypto.call('drop', { token: value.token }); }
	}
	private async commit(change: Change, password: string | null): Promise<void> {
		await this.preflight(change);
		if (change.enabled && !this.guard) { this.guard = new ProtectedIndexCleanup(this.app, new Set(change.entries.map(e => e.source))); this.guard.install(); }
		for (const entry of change.entries) {
			const staged = await this.adapter.read(this.stage(change, entry.index));
			const output = change.enabled ? staged : await this.opened(staged, password!, entry);
			if (await this.hash(this.bytes(output)) !== entry.after) throw Error('日记恢复正文校验失败，原文件保留');
			await this.publish(entry.target, output, entry.after);
		}
		await this.preflight(change, true);
		for (const entry of change.entries) {
			if (!await this.adapter.exists(entry.source)) continue;
			if (await this.hash(new Uint8Array(await this.adapter.readBinary(entry.source))) !== entry.before) throw Error(`日记仍在变化，停止删除：${entry.source}`);
			const file = this.app.vault.getAbstractFileByPath(entry.source);
			if (!(file instanceof TFile)) throw Error(`日记文件尚未进入 Obsidian 索引：${entry.source}`);
			await this.app.vault.delete(file, true);
		}
		if (change.enabled) await this.guard?.clean();
		else for (const entry of change.entries) await utimes(await this.diskPath(entry.target), new Date(), new Date(entry.mtime));
		await this.adapter.write(DAILY_MODE_FILE, JSON.stringify({ version: 1, enabled: change.enabled }) + '\n');
		if ((JSON.parse(await this.adapter.read(DAILY_MODE_FILE)) as { enabled?: boolean }).enabled !== change.enabled) throw Error('日记开关保存失败');
		await this.adapter.remove(DAILY_CHANGE_FILE);
		this.pending = false; this.enabled = change.enabled; this.paths.clear();
		await this.removeStages(change);
		this.guard?.unload(); this.guard = null;
		for (const entry of change.entries) { invalidateDql(entry.source); invalidateDql(entry.target); invalidateTasks(entry.source); invalidateTasks(entry.target); }
		this.controller.plugin.refreshAllDashboards();
	}
	private async removeStages(change: Change): Promise<void> {
		for (const entry of change.entries) try { await this.adapter.remove(this.stage(change, entry.index)); } catch { /* ciphertext only */ }
		try { const path = `${DAILY_STAGING}/${change.id}`; const contents = await this.adapter.list(path); if (!contents.files.length && !contents.folders.length) await rmdir(await this.diskPath(path)); } catch { /* retain unexpected content */ }
	}
	async setEnabled(enabled: boolean): Promise<void> {
		await this.assertReady(); await this.controller.credentials.assertReady();
		if (this.controller.credentials.creating || this.controller.session.active) throw Error('请先完成正在进行的加密操作');
		let recipient: unknown = enabled ? await this.controller.credentials.get() : null;
		if (enabled && !recipient) { await this.controller.credentials.setup(); recipient = await this.controller.credentials.get(); if (!recipient) return; }
		this.busy = true; let change: Change | null = null, published = false, completed = false;
		try {
			const initial = await this.scan(enabled);
			const files = enabled ? initial.plain : initial.cipher;
			const password = !enabled && files.length ? await askPassword(this.app, '关闭日记加密：恢复原 Markdown') : null;
			if (!enabled && files.length && password === null) return;
			this.paths = new Set(files.map(f => f.path));
			await this.closeEditors(this.paths);
			const current = await this.scan(enabled);
			const sources = enabled ? current.plain : current.cipher;
			change = { version: 1, id: freshId(), enabled, previous: await this.adapter.exists(DAILY_MODE_FILE) ? await this.adapter.read(DAILY_MODE_FILE) : null, entries: [] };
			const stageDir = `${DAILY_STAGING}/${change.id}`;
			if (!await this.adapter.exists(DAILY_STAGING)) await this.adapter.mkdir(DAILY_STAGING);
			await this.adapter.mkdir(stageDir);
			for (const [index, file] of sources.entries()) {
				const source = file.path, target = enabled ? source.slice(0, -3) + DAILY_EXTENSION : source.slice(0, -DAILY_EXTENSION.length) + '.md';
				this.validPath(source); this.validPath(target);
				if (await this.adapter.exists(target)) throw Error(`日记明文与密文同名冲突，未开始转换：${target}`);
				const bytes = new Uint8Array(await this.adapter.readBinary(source));
				const before = await this.hash(bytes);
				const diskStat = await lstat(await this.diskPath(source));
				let staged: string, after: string, mtime = diskStat.mtimeMs, ctime = diskStat.ctimeMs;
				if (enabled) {
					const raw = this.raw(bytes);
					staged = await this.controller.crypto.call<string>('create-daily-public', { markdown: raw, title: file.basename, recipient, document: { kind: 'daily', version: 1, path: source, mtime, ctime } });
					after = await this.hash(this.bytes(staged));
				} else {
					staged = this.raw(bytes);
					const value = await this.controller.crypto.call<OpenedDaily>('open-all', { text: staged, password });
					try {
						const doc = value.payloads?.[0]?.document;
						if (value.payloads?.length !== 1 || doc?.kind !== 'daily' || doc.version !== 1 || doc.path !== target || !Number.isFinite(doc.mtime) || !Number.isFinite(doc.ctime)) throw Error(`日记密文元数据无效：${source}`);
						after = await this.hash(this.bytes(value.markdown));
						mtime = doc.mtime; ctime = doc.ctime;
					} finally { await this.controller.crypto.call('drop', { token: value.token }); }
				}
				const entry: Entry = { source, target, before, after, index, mtime, ctime };
				await this.adapter.write(this.stage(change, index), staged);
				if (await this.hash(this.bytes(await this.adapter.read(this.stage(change, index)))) !== await this.hash(this.bytes(staged))) throw Error('日记密文暂存校验失败');
				change.entries.push(entry);
				this.paths.add(target);
				this.controller.status(`正在准备日记${enabled ? '加密' : '解密'}：${index + 1}/${sources.length}`);
			}
			await this.preflight(change);
			await this.adapter.write(DAILY_CHANGE_FILE, JSON.stringify(change)); published = true; this.pending = true;
			await this.commit(JSON.parse(await this.adapter.read(DAILY_CHANGE_FILE)) as Change, password); completed = true;
		} finally {
			this.busy = false;
			if (!published && change) await this.removeStages(change);
			if (!this.pending) { this.paths.clear(); this.guard?.unload(); this.guard = null; }
		}
		if (completed) new Notice(enabled ? '现有日记已加密；之后新建的明文日记可手动补加密。' : '日记已恢复为普通 Markdown。', 10000);
	}
	async resume(): Promise<void> {
		if (this.busy) throw Error('日记切换正在进行');
		if (this.controller.credentials.busy || this.controller.credentials.creating || this.controller.mode.busy || this.controller.mode.pending || this.controller.session.active) throw Error('请先完成正在进行的周记或密码操作');
		if (!await this.adapter.exists(DAILY_CHANGE_FILE)) { this.pending = false; return; }
		this.busy = true;
		try {
			const change = JSON.parse(await this.adapter.read(DAILY_CHANGE_FILE)) as Change;
			await this.validate(change);
			this.paths = new Set(change.entries.flatMap(e => [e.source, e.target]));
			const password = change.enabled ? null : await askPassword(this.app, '继续解密日记：验证统一密码');
			if (!change.enabled && password === null) return;
			await this.closeEditors(this.paths);
			await this.commit(change, password);
			new Notice('日记加密切换已完成');
		} finally { this.busy = false; }
	}
	unload(): void { this.guard?.unload(); this.guard = null; }
}
