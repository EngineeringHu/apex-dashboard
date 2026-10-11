import { App, Modal } from 'obsidian';
import { tableLayoutHarness } from './table-layout-harness';

export function showPreview(app: App, css: string) {
    class Preview extends Modal {
        private harness?: ReturnType<typeof tableLayoutHarness>;
        onOpen() {
            this.titleEl.setText('周计划表 · 自适应布局预览');
            this.modalEl.addClass('apex-table-preview');
            this.modalEl.style.width = 'min(1700px, 96vw)';
            this.modalEl.style.maxWidth = '96vw';
            this.contentEl.createEl('style', { text: '@scope (.apex-table-preview) {' + css + '\n}' });
            this.contentEl.createEl('p', { text: '合成示例：拖动顶部列边界、左侧行边界或分区底边；双击恢复，Esc 取消。右键单元格可增删行列。这里的内容与布局仅保留到关闭预览，不修改真实笔记。' });
            const viewport = this.contentEl.createDiv();
            viewport.style.overflow = 'auto';
            const host = viewport.createDiv({ cls: 'apex-dashboard-root' });
            host.dataset.theme = document.querySelector<HTMLElement>('.apex-dashboard-root')?.dataset.theme ?? 'earth';
            Object.assign(host.style, { height: 'auto', minHeight: '0', padding: '8px', width: '100%' });
            const controls = this.contentEl.createDiv();
            controls.style.marginTop = '8px';
            for (const [label, width] of [['适应窗口', '100%'], ['模拟 800px 分屏', '800px']] as const) {
                controls.createEl('button', { text: label }).onclick = () => { host.style.width = width; };
            }
            this.harness = tableLayoutHarness(app, host);
        }
        onClose() { this.harness?.dispose(); this.contentEl.empty(); }
    }
    const preview = new Preview(app);
    preview.open();
    return { opened: true, columns: preview.contentEl.querySelectorAll('col').length };
}
