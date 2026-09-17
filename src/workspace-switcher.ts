import { Menu, setIcon } from 'obsidian';
import type DashboardPlugin from './main';
import { t } from './i18n';
import { showPromptDialog } from './prompt-dialog';
import { showConfirmDialog } from './confirm-dialog';
import { normalizeWorkspacePath } from './workspace-registry';

/** Display label for a workspace: its name, else the file path. */
function workspaceLabel(name: string, path: string): string {
	return name.trim() || `${path}.md`;
}

/** Open the "new workspace" dialog and create the workspace on confirm. In
 *  folder mode this is a new EMPTY weekly board inside the workspace folder,
 *  named after the prompt (file name = board name). */
async function promptNewWorkspace(plugin: DashboardPlugin): Promise<void> {
	if (plugin.workspaceFolder()) {
		const fallback = t('workspace.defaultWeeklyName', { n: plugin.folderWorkspaceFiles().length + 1 });
		const name = await showPromptDialog(plugin.app, {
			title: t('workspace.newWeeklyTitle'),
			placeholder: t('workspace.weeklyNamePlaceholder'),
			defaultValue: fallback,
		});
		if (name === null) return;
		await plugin.createWorkspace(name === '' ? fallback : name);
		return;
	}
	const files = plugin.settings.workspaceFiles;
	const fallback = t('workspace.defaultName', { n: files.length + 1 });
	const name = await showPromptDialog(plugin.app, {
		title: t('workspace.newTitle'),
		placeholder: t('workspace.namePlaceholder'),
		defaultValue: fallback,
	});
	if (name === null) return;
	await plugin.createWorkspace(name === '' ? fallback : name);
}

/** Long-press / right-click management menu for one workspace button. */
function openWorkspaceMenu(plugin: DashboardPlugin, file: string, name: string, ev: Event): void {
	const menu = new Menu();
	menu.addItem((item) => {
		item.setTitle(t('workspace.renameTitle'))
			.setIcon('pencil')
			.onClick(async () => {
				const next = await showPromptDialog(plugin.app, {
					title: t('workspace.renameTitle'),
					placeholder: t('workspace.namePlaceholder'),
					defaultValue: name,
				});
				if (next !== null) await plugin.renameWorkspace(file, next);
			});
	});
	menu.addItem((item) => {
		const canRemove = plugin.settings.workspaceFiles.length > 1;
		item.setTitle(t('workspace.removeTitle'))
			.setIcon('trash-2')
			.setDisabled(!canRemove);
		if (!canRemove) return;
		item.onClick(async () => {
			const confirmed = await showConfirmDialog(plugin.app, {
				title: t('workspace.removeTitle'),
				message: t('workspace.removeConfirm', { name: name || file, file: `${file}.md` }),
			});
			if (confirmed) await plugin.removeWorkspace(file);
		});
	});
	menu.showAtMouseEvent(ev as MouseEvent);
}

/** Folder mode: a compact dropdown over every Markdown file in the workspace
 *  folder (plus legacy non-folder workspaces) replaces the number pills. */
function renderFolderSwitcher(switcher: HTMLElement, plugin: DashboardPlugin): void {
	const active = normalizeWorkspacePath(plugin.settings.dashboardFile);
	const choices = plugin.getWorkspaceChoices();

	const select = switcher.createEl('select', {
		cls: 'dashboard-workspace-select',
		attr: { 'aria-label': plugin.workspaceFolder(), title: plugin.workspaceFolder() },
	});
	if (!choices.some((c) => c.path === active)) {
		// Active file not among the choices (folder just changed / sync lag):
		// keep it visible so the selection never silently jumps.
		select.createEl('option', { text: workspaceLabel('', active), value: active });
	}
	for (const choice of choices) {
		const opt = select.createEl('option', { text: choice.label, value: choice.path });
		if (choice.path === active) opt.selected = true;
	}
	if (select.selectedIndex < 0 && select.options.length > 0) {
		select.selectedIndex = 0;
	}
	select.addEventListener('change', () => {
		void plugin.switchWorkspace(select.value);
	});
}

/**
 * Workspace switcher on the banner, at the top-left corner of the stats
 * view's center column (the CSS mirrors the stats grid to find that edge).
 * Resting semi-visible, full on hover/focus; on mobile there is no hover, so
 * it stays visible. Rebuilt on every render so the active highlight always
 * matches the current settings.
 *
 * Folder mode (settings.workspaceFolder set) renders a file dropdown;
 * otherwise the classic number pills + add button.
 */
export function renderWorkspaceSwitcher(container: HTMLElement, plugin: DashboardPlugin): void {
	const active = normalizeWorkspacePath(plugin.settings.dashboardFile);

	const switcher = container.createDiv({ cls: 'dashboard-workspace-switcher' });

	if (plugin.workspaceFolder()) {
		renderFolderSwitcher(switcher, plugin);
	} else {
		renderPillSwitcher(switcher, plugin, active);
	}

	const addBtn = switcher.createEl('button', {
		cls: 'dashboard-workspace-btn dashboard-workspace-add-btn',
		attr: { 'aria-label': t('workspace.newTitle'), title: t('workspace.newTitle') },
	});
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		void promptNewWorkspace(plugin);
	});
}

/** Number pills for the classic registry workspaces. */
function renderPillSwitcher(switcher: HTMLElement, plugin: DashboardPlugin, active: string): void {
	const { workspaceFiles, workspaceNames } = plugin.settings;
	workspaceFiles.forEach((file, i) => {
		const name = workspaceNames?.[i]?.trim() ?? '';
		const label = workspaceLabel(name, file);
		const isActive = normalizeWorkspacePath(file) === active;
		const btn = switcher.createEl('button', {
			cls: 'dashboard-workspace-btn' + (isActive ? ' active' : ''),
			text: String(i + 1),
			attr: { 'aria-label': label, title: label },
		});
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			void plugin.switchWorkspace(file);
		});
		btn.addEventListener('contextmenu', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			openWorkspaceMenu(plugin, file, name, ev);
		});
	});
}
