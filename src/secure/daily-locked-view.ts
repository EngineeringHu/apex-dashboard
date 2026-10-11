import { FileView, TFile, type WorkspaceLeaf } from 'obsidian';
import { DAILY_LOCKED_MESSAGE } from './daily-access';

export const DAILY_LOCKED_VIEW = 'apex-daily-locked-view';

/** Encrypted diaries have no plaintext editor in the first version. */
export class DailyLockedView extends FileView {
	constructor(leaf: WorkspaceLeaf) { super(leaf); }
	getViewType(): string { return DAILY_LOCKED_VIEW; }
	getDisplayText(): string { return this.file?.basename ?? '加密日记'; }
	getIcon(): string { return 'lock-keyhole'; }
	async onLoadFile(_file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: '🔒 日记已加密' });
		this.contentEl.createEl('p', { text: DAILY_LOCKED_MESSAGE });
	}
	async onUnloadFile(): Promise<void> { this.contentEl.empty(); }
}
