import type { App } from 'obsidian';
import { tableLayoutHarness } from './table-layout-harness';
import { parseTableSectionRows, serializeDenseRows } from '../src/table-model';
import { DashboardView } from '../src/view';
import { DEFAULT_SETTINGS, type RenderCallbacks } from '../src/types';

export async function run(app: App) {
    const assert = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
    const tick = () => new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 250);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    });
    const host = document.body.createDiv({ cls: 'apex-dashboard-root apex-table-test' });
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '1600px', height: 'auto', padding: '0' });
    const harness = tableLayoutHarness(app, host);
    const checks: string[] = [];
    try {
        await tick();
        const snapshot = harness.stats();
        const query = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
        const drag = (element: HTMLElement, dx: number, dy = 0, cancel = false) => {
            const box = element.getBoundingClientRect(), x = box.left + 2, y = box.top + 2;
            // Synthetic PointerEvents cannot own native pointer capture.
            element.setPointerCapture = () => {};
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 77, clientX: x, clientY: y }));
            document.dispatchEvent(new PointerEvent('pointermove', { pointerId: 77, clientX: x + dx, clientY: y + dy }));
            document.dispatchEvent(new PointerEvent(cancel ? 'pointercancel' : 'pointerup', { pointerId: 77, clientX: x + dx, clientY: y + dy }));
        };
        assert(host.querySelectorAll('col').length === 11, 'all eleven logical columns have widths');
        const label = query('.apex-table-todo-card .dashboard-task-text');
        assert(label.getBoundingClientRect().width >= 55, 'narrow task columns retain readable text width');
        const cardTitle = query('.apex-table-todo-card .dashboard-card-title');
        assert(cardTitle.getBoundingClientRect().width >= 80, 'card controls do not crush the title');
        const guide = host.querySelectorAll<HTMLElement>('.apex-table-column-grip')[4]!;
        const initialWidth = query<HTMLTableColElement>('colgroup').children[4]!.getBoundingClientRect().width;
        drag(guide, 100);
        await tick();
        let layout = harness.layouts[harness.path]![harness.key]!;
        assert(Math.abs(layout.columns[4]!.size! - initialWidth - 100) < 3, 'column drag saves requested width');
        const fixedWidth = layout.columns[4]!.size!;
        drag(host.querySelectorAll<HTMLElement>('.apex-table-row-grip')[4]!, 0, 70);
        await tick();
        layout = harness.layouts[harness.path]![harness.key]!;
        assert(layout.rows[4]!.size! >= 70, 'row drag saves height');
        drag(query('.apex-table-section-grip'), 0, 100);
        assert(harness.layouts[harness.path]![harness.key]!.maxHeight >= 600, 'section drag changes layout only');
        assert(harness.stats().markdown === snapshot.markdown && harness.stats().contentWrites === 0, 'all resize gestures leave Markdown byte-for-byte unchanged');
        checks.push('column, row and section drags persist independently with zero note-content writes');
        const saved = JSON.stringify(harness.layouts);
        drag(guide, 80, 0, true);
        assert(JSON.stringify(harness.layouts) === saved, 'pointer cancellation does not save');
        assert(Math.abs(parseFloat(query('colgroup').children[4]!.getAttribute('style')!.match(/width: ([\d.]+)/)![1]!) - fixedWidth) < 1, 'cancel restores width');
        host.style.width = '800px'; await tick();
        assert(query('.dashboard-table-wrap').scrollWidth > query('.dashboard-table-wrap').clientWidth, 'narrow view scrolls locally');
        assert(query('table').getBoundingClientRect().width > 800, 'narrow view preserves readable minimum widths');
        assert(Math.abs((query('colgroup').children[4] as HTMLElement).getBoundingClientRect().width - fixedWidth) < 3, 'manual width survives split-pane resize');
        const wrap = query('.dashboard-table-wrap'); wrap.scrollLeft = 120;
        harness.render(); await tick();
        assert(query('.dashboard-table-wrap').scrollLeft >= 119, 'rerender keeps scroll position');
        assert(harness.layouts[harness.path]![harness.key]!.columns[4]!.size === fixedWidth, 'rerender retains width');
        checks.push('cancel, split-pane overflow, rerender persistence and scroll preservation');

        const oldId = harness.layouts[harness.path]![harness.key]!.columns[4]!.id;
        const contextCell = query('td[data-table-row="2"][data-table-col="4"]');
        contextCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
        const menuItem = [...document.querySelectorAll<HTMLElement>('.menu-item')].find(el => /在左侧插入列|Insert column left/.test(el.textContent ?? ''));
        assert(menuItem, 'insert column menu exists'); menuItem!.click(); await tick();
        layout = harness.layouts[harness.path]![harness.key]!;
        assert(host.querySelectorAll('col').length === 12, 'context menu inserts a logical column');
        assert(layout.columns[5]!.id === oldId && layout.columns[5]!.size === fixedWidth, 'width follows column across insertion');
        assert(layout.columns[4]!.size === undefined, 'inserted column starts automatic');
        checks.push('real context-menu insertion preserves widths on the correct logical columns');
        const current = harness.engine.getData()!.columns[0]!;
        const external = parseTableSectionRows(current.tableContent!);
        external.splice(3, 0, Array.from({ length: 12 }, () => ''));
        harness.callbacks.onTableContentChange(current.name, serializeDenseRows(external)); await tick();
        assert(host.querySelectorAll('.apex-table-row-grip').length === external.length, 'raw Markdown structural edits reconcile');
        assert(query('td[rowspan]') && query('th[colspan]'), 'vertical and horizontal merged cells still render');
        assert(host.querySelectorAll('.apex-table-todo-card').length === 3, 'task cards survive structural edits');
        external.forEach(row => row.unshift('', ''));
        external.splice(1, 0, Array.from({ length: 14 }, () => ''));
        harness.callbacks.onTableContentChange(current.name, serializeDenseRows(external)); await tick();
        const shiftedRole = query('td[data-table-row="3"][data-table-col="2"]');
        assert(shiftedRole.dataset.tableRole === 'role' && shiftedRole.hasClass('apex-table-cell--editable'), 'role cell stays plain text after leading row/column insertion');
        assert(!query('td[data-table-row="2"][data-table-col="4"]').hasClass('apex-table-cell--tasks'), 'shifted goal heading does not become a task');
        checks.push('external Markdown structure changes, merged cells and embedded tasks remain supported');

        const beforeReset = harness.stats().contentWrites;
        (host.querySelectorAll<HTMLButtonElement>('.apex-table-layout-toolbar button')[1]!).click(); await tick();
        layout = harness.layouts[harness.path]![harness.key]!;
        assert(layout.rows.every(r => r.size === undefined) && layout.columns.every(c => c.size === undefined), 'reset removes only manual dimensions');
        assert(layout.heightMode === 'auto' && query('.apex-table-section').style.maxHeight === 'none', 'reset fits content');
        assert(harness.stats().contentWrites === beforeReset, 'reset does not write Markdown');
        checks.push('reset restores automatic dimensions without writing note contents');

        // Exercise the real view callback wiring without opening a leaf or a file.
        const makeView = (protectedPath?: string) => {
            const view = Object.create(DashboardView.prototype);
            Object.assign(view, { data: harness.engine.getData(), sync: harness.engine,
                plugin: { settings: DEFAULT_SETTINGS, tableLayouts: harness.store, workspaceFolder: () => 'synthetic',
                    secure: { templates: { file: () => null }, mode: {}, session: {} } },
                protectedBridge: protectedPath ? { path: () => protectedPath, callbacks: (base: RenderCallbacks) => base } : undefined,
            });
            return view as { createCallbacks(): RenderCallbacks };
        };
        const beforeBinding = harness.stats();
        const syntheticColumn = harness.engine.getData()!.columns[0]!;
        for (const protectedPath of [undefined, 'synthetic-protected.apexenc']) {
            const view = makeView(protectedPath);
            const column = protectedPath ? { ...syntheticColumn, protectedBlockId: 'test-block-id' } : syntheticColumn;
            const binding = view.createCallbacks().getTableLayout!(column);
            const updated = structuredClone(binding.layout); updated.columns[0]!.size = 231;
            await binding.save(updated);
            const reopened = makeView(protectedPath).createCallbacks().getTableLayout!(column);
            assert(reopened.layout.columns[0]!.size === 231, 'actual view callback retains independent layout');
        }
        assert(harness.stats().contentWrites === beforeBinding.contentWrites, 'ordinary and protected layout callbacks do not call content writer');
        assert(harness.layouts['synthetic-protected.apexenc']!['secure:test-block-id'], 'protected view uses its own file and block identity');
        checks.push('actual ordinary/protected DashboardView layout callbacks save independently of note/encryption writers');
        return { passed: true, checks, vaultWrites: 0 };
    } finally { harness.dispose(); host.remove(); }
}
