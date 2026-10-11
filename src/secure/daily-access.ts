import type { App } from 'obsidian';

export const DAILY_ROOT = '日记';
export const DAILY_EXTENSION = '.apexdaily';
export const DAILY_LOCKED_MESSAGE = '该日记已加密，请先在 Apex 设置中关闭日记加密并完成解密';
const modes = new WeakMap<App, { pending: boolean; busy: boolean; affected(path: string): boolean }>();

export function registerDailyAccess(app: App, mode: { pending: boolean; busy: boolean; affected(path: string): boolean }): void {
	modes.set(app, mode);
}

export function dailyCipherPath(path: string): string | null {
	return path.startsWith(`${DAILY_ROOT}/`) && path.endsWith('.md') ? `${path.slice(0, -3)}${DAILY_EXTENSION}` : null;
}

export function dailyAccessState(app: App, path: string): 'plain' | 'encrypted' | 'conflict' | 'switching' {
	const cipher = dailyCipherPath(path);
	if (!cipher) return 'plain';
	const mode = modes.get(app);
	if (mode?.affected(path)) return 'switching';
	const encrypted = !!app.vault.getAbstractFileByPath(cipher);
	if (!encrypted) return 'plain';
	return app.vault.getAbstractFileByPath(path) ? 'conflict' : 'encrypted';
}

export function assertDailyAccessible(app: App, path: string): void {
	if (path.startsWith(`${DAILY_ROOT}/`) && path.endsWith(DAILY_EXTENSION)) throw Error(`${DAILY_LOCKED_MESSAGE}：${path}`);
	const state = dailyAccessState(app, path);
	if (state === 'conflict') throw Error(`日记明文与密文同名冲突：${path}。请先将新建明文改名保存`);
	if (state === 'encrypted') throw Error(`${DAILY_LOCKED_MESSAGE}：${path}`);
	if (state === 'switching') throw Error(`日记正在切换加密，请完成或恢复切换后重试：${path}`);
}
