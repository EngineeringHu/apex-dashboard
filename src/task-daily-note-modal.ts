import { App, Modal, Notice } from 'obsidian';
import { getOrCreateDailyNote } from './daily-notes';
import { nowMoment } from './datetime';
import { PathPickerModal } from './path-picker-modal';
import { t } from './i18n';
import { assertDailyAccessible } from './secure/daily-access';

/** Linking stores a path only; it does not export the task into an unencrypted note. */
export class DailyNoteLinkModal extends Modal {
    constructor(app: App, private current: string | undefined, private onPick: (path: string | undefined) => void) { super(app); }
    onOpen(): void {
        const el = this.contentEl;
        el.empty();
        el.createEl('h3', { text: t('task.linkDaily') });
        if (this.current) el.createEl('p', { text: this.current });
        const existing = el.createEl('button', { text: t('task.pickDaily') });
        existing.addEventListener('click', () => {
            this.close();
            new PathPickerModal(this.app, 'file', path => {
                try { assertDailyAccessible(this.app, path); this.onPick(path); }
                catch (error) { new Notice((error as Error).message, 10000); }
            }).open();
        });
        const row = el.createDiv({ cls: 'apex-daily-link-date' });
        const date = row.createEl('input', { attr: { type: 'date', 'aria-label': t('task.dailyDate') } });
        date.value = nowMoment().format('YYYY-MM-DD');
        const byDate = row.createEl('button', { text: t('task.linkDailyDate') });
        byDate.addEventListener('click', () => { void (async () => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value) || !date.checkValidity()) return;
            byDate.disabled = true;
            try {
                const file = await getOrCreateDailyNote(this.app, date.value);
                if (!file) { new Notice(t('notice.dailyNotesDisabled')); return; }
                this.onPick(file.path);
                this.close();
            } catch (error) {
                console.error('[Apex] link daily note', error);
                new Notice(error instanceof Error ? error.message : t('notice.dailySaveError'));
            } finally { byDate.disabled = false; }
        })(); });
        if (this.current) {
            const unlink = el.createEl('button', { text: t('task.unlinkDaily') });
            unlink.addEventListener('click', () => { this.onPick(undefined); this.close(); });
        }
    }
    onClose(): void { this.contentEl.empty(); }
}
