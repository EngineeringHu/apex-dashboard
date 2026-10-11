import { Notice, Platform } from 'obsidian';
import { t } from './i18n';
import { calculateTableWidths, tableColumnDefaults, type TableLayoutBinding } from './table-layout';

const controllers = new Map<HTMLElement, () => void>();
export function disposeTableLayouts(root: Element): void {
    for (const [host, dispose] of controllers) if (root === host || root.contains(host)) dispose();
}

/** Uses the element's document/window so gestures also work in Obsidian pop-out windows. */
export function attachTableLayout(host: HTMLElement, wrap: HTMLElement, table: HTMLTableElement,
    content: string, binding: TableLayoutBinding): void {
    const doc = host.ownerDocument, win = doc.defaultView!;
    let layout = structuredClone(binding.layout), disposed = false;
    let cancelDrag: (() => void) | undefined;
    const defaults = tableColumnDefaults(content);
    const toolbar = doc.createElement('div');
    toolbar.className = 'apex-table-layout-toolbar';
    host.insertBefore(toolbar, wrap);
    const mode = toolbar.createEl('button', { attr: { type: 'button' } });
    const reset = toolbar.createEl('button', { text: t('table.layoutReset'), attr: { type: 'button' } });
    toolbar.createSpan({ cls: 'apex-table-layout-help', text: t('table.layoutHelp') });
    const canvas = doc.createElement('div');
    canvas.className = 'apex-table-canvas';
    wrap.insertBefore(canvas, table);
    const ruler = canvas.createDiv({ cls: 'apex-table-column-ruler' });
    canvas.appendChild(table);
    const colgroup = doc.createElement('colgroup');
    table.prepend(colgroup);
    const cols = defaults.map(() => colgroup.createEl('col'));
    const rowEls = Array.from(table.rows);
    const rowHandles: HTMLElement[] = [];
    const columnSlots: HTMLElement[] = [];
    host.addClass('apex-table-section');
    let widths: number[] = [];

    const persist = () => {
        void binding.save(structuredClone(layout)).catch(error => {
            console.error('Table layout save failed', error);
            new Notice(t('table.layoutSaveFailed'));
        });
    };
    const positionRows = () => {
        const origin = canvas.getBoundingClientRect().top;
        rowHandles.forEach((handle, i) => {
            handle.style.top = `${rowEls[i]!.getBoundingClientRect().bottom - origin - 4}px`;
        });
    };
    const apply = () => {
        if (disposed) return;
        const style = win.getComputedStyle(wrap);
        const available = Math.max(0, wrap.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0') - 3);
        widths = calculateTableWidths(layout, defaults, available);
        const width = widths.reduce((sum, value) => sum + value, 0);
        canvas.style.width = `${width + 3}px`;
        table.style.width = `${width + 3}px`;
        cols.forEach((col, i) => { col.style.width = `${widths[i]}px`; });
        columnSlots.forEach((slot, i) => { slot.style.width = `${widths[i]}px`; });
        rowEls.forEach((row, i) => { row.style.height = layout.rows[i]?.size ? `${layout.rows[i].size}px` : ''; });
        host.style.maxHeight = layout.heightMode === 'auto' ? 'none' : `${layout.maxHeight}px`;
        host.dataset.tableHeightMode = layout.heightMode;
        mode.setText(t(layout.heightMode === 'auto' ? 'table.heightAuto' : 'table.heightLimited'));
        mode.setAttribute('aria-pressed', String(layout.heightMode === 'limited'));
        positionRows();
    };

    const grip = (element: HTMLElement, direction: 'column' | 'row' | 'section', index = 0) => {
        const horizontal = direction === 'column';
        const entries = () => horizontal ? layout.columns : layout.rows;
        const readSize = () => horizontal ? widths[index]! : direction === 'row'
            ? rowEls[index]!.getBoundingClientRect().height : host.getBoundingClientRect().height;
        const setSize = (value: number) => {
            if (direction === 'section') {
                layout.heightMode = 'limited';
                layout.maxHeight = Math.round(Math.max(160, Math.min(2000, value)));
            } else entries()[index]!.size = Math.round(Math.max(horizontal ? defaults[index]!.min : 28, Math.min(1200, value)));
            apply();
        };
        element.setAttribute('role', 'separator');
        element.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal');
        element.tabIndex = 0;
        const label = direction === 'section' ? t('table.resizeSection') : t(horizontal ? 'table.resizeColumn' : 'table.resizeRow', { n: index + 1 });
        element.setAttribute('aria-label', label);
        element.title = label + ' · ' + t('table.resizeHint');
        element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });
        element.addEventListener('dblclick', event => {
            event.preventDefault(); event.stopPropagation();
            if (direction === 'section') layout.heightMode = 'auto';
            else delete entries()[index]!.size;
            apply(); persist();
        });
        element.addEventListener('keydown', event => {
            if (event.key === 'Escape') { cancelDrag?.(); return; }
            const delta = event.key === (horizontal ? 'ArrowRight' : 'ArrowDown') ? 10
                : event.key === (horizontal ? 'ArrowLeft' : 'ArrowUp') ? -10 : 0;
            if (!delta) return;
            event.preventDefault(); event.stopPropagation();
            setSize(readSize() + delta); persist();
        });
        element.addEventListener('pointerdown', event => {
            if (event.button !== 0 || Platform.isMobile) return;
            event.preventDefault(); event.stopPropagation();
            cancelDrag?.();
            const before = structuredClone(layout), start = horizontal ? event.clientX : event.clientY, size = readSize();
            let moved = false;
            host.addClass('apex-table-resizing');
            element.setPointerCapture?.(event.pointerId);
            const move = (next: PointerEvent) => {
                if (next.pointerId !== event.pointerId) return;
                const delta = (horizontal ? next.clientX : next.clientY) - start;
                if (Math.abs(delta) < 2 && !moved) return;
                moved = true; setSize(size + delta);
            };
            const cleanup = () => {
                doc.removeEventListener('pointermove', move);
                doc.removeEventListener('pointerup', up);
                doc.removeEventListener('pointercancel', cancel);
                doc.removeEventListener('keydown', key);
                win.removeEventListener('blur', cancel);
                element.removeEventListener('lostpointercapture', cancel);
                host.removeClass('apex-table-resizing');
                cancelDrag = undefined;
                if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
            };
            const cancel = () => { cleanup(); layout = before; apply(); };
            const up = (next: PointerEvent) => {
                if (next.pointerId !== event.pointerId) return;
                move(next); cleanup(); if (moved) persist();
            };
            const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); cancel(); } };
            cancelDrag = cancel;
            doc.addEventListener('pointermove', move);
            doc.addEventListener('pointerup', up);
            doc.addEventListener('pointercancel', cancel);
            doc.addEventListener('keydown', key);
            win.addEventListener('blur', cancel);
            element.addEventListener('lostpointercapture', cancel);
        });
    };
    if (!Platform.isMobile) {
        cols.forEach((_, index) => {
            const slot = ruler.createDiv({ cls: 'apex-table-column-slot' });
            columnSlots.push(slot);
            slot.createSpan({ text: String(index + 1) });
            grip(slot.createDiv({ cls: 'apex-table-column-grip' }), 'column', index);
        });
        rowEls.forEach((_, index) => {
            const handle = canvas.createDiv({ cls: 'apex-table-row-grip' });
            rowHandles.push(handle); grip(handle, 'row', index);
        });
        const sectionHandle = host.createDiv({ cls: 'apex-table-section-grip' });
        grip(sectionHandle, 'section');
    }
    mode.addEventListener('click', () => { layout.heightMode = layout.heightMode === 'auto' ? 'limited' : 'auto'; apply(); persist(); });
    reset.addEventListener('click', () => {
        layout.rows.forEach(entry => delete entry.size);
        layout.columns.forEach(entry => delete entry.size);
        layout.heightMode = 'auto'; apply(); persist();
    });
    const observer = new ResizeObserver(() => apply());
    observer.observe(wrap);
    const rowObserver = new ResizeObserver(() => positionRows());
    rowObserver.observe(table);
    rowEls.forEach(row => rowObserver.observe(row));
    const frame = win.requestAnimationFrame(apply);
    controllers.set(host, () => {
        cancelDrag?.(); disposed = true;
        observer.disconnect(); rowObserver.disconnect(); win.cancelAnimationFrame(frame);
        controllers.delete(host);
    });
    apply();
}
