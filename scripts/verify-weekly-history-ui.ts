import type { App } from 'obsidian';
import { renderDataviewSection } from '../src/dataview-section';
import { DataviewConfigModal } from '../src/dataview-config-modal';
import { weeklyHistoryConfig } from '../src/weekly-history-config';
import { invalidatePath } from '../src/dql/page-builder';
import { taskFilterFixture } from './history-dql-fixture';
import { parse, serialize } from '../src/parser';
import { addWeeklyHistory } from '../src/weekly-history';
import type { DataviewConfig } from '../src/types';

export async function run(realApp: App) {
 const assert = (v: unknown, m: string) => { if (!v) throw Error(m); };
 const tick = async () => { for (let i = 0; i < 160; i++) await Promise.resolve(); };
 const f = taskFilterFixture(); f.files.forEach(file => invalidatePath(file.path));
 const app = Object.create(realApp);
 Object.defineProperty(app, 'vault', { value: f.app.vault });
 Object.defineProperty(app, 'metadataCache', { value: f.app.metadataCache });
 const host = document.createElement('div');
 host.className = 'apex-dashboard-root apex-history-filter-test';
 host.style.cssText = 'position:fixed;left:24px;top:24px;width:min(900px,92vw);max-height:90vh;overflow:auto;z-index:10000;padding:20px;background:var(--background-primary)';
 document.body.appendChild(host);
 let opened = '', locked = false, refresh = () => {}, persisted: DataviewConfig | undefined;
 const context = { folder: '周记', currentPath: f.current.path, templatePath: f.template.path, unavailable: () => locked, open: async (file: any) => { opened = file.path; } };
 const checks: string[] = [];
 const config = weeklyHistoryConfig();
 const mount = (cfg: DataviewConfig) => {
  host.empty(); opened = '';
  host.createEl('h3', {text: '历史未完成计划 · 合成测试'});
  renderDataviewSection(host, {name: 'History', color: '#123456', cards: [], sectionType: 'dataview', dataviewConfig: cfg}, app, null, null, fn => { refresh = fn; }, next => {
   // Exercise the real Markdown configuration roundtrip with an in-memory note.
   const data = parse(addWeeklyHistory(f.data.get(f.current.path)!));
   data.columns.find(c => c.dataviewConfig)!.dataviewConfig = next;
   persisted = parse(serialize(data)).columns.find(c => c.dataviewConfig)!.dataviewConfig;
  }, context);
 };
 const labels = () => Array.from(host.querySelectorAll<HTMLElement>('.dashboard-dataview-task-text'));
 const toggle = async (key: string, value: string) => {
  const box = host.querySelector<HTMLInputElement>(`input[data-filter="${key}"][value="${value}"]`);
  assert(box, 'filter checkbox exists: ' + key + '/' + value); box!.click(); await tick();
 };
 try {
  for (const viewMode of ['auto', 'list', 'table'] as const) {
   mount({...config, viewMode}); await tick();
   assert(labels().length === 10, 'all noncompleted task states rendered in ' + viewMode);
   assert(host.querySelectorAll('.dashboard-dataview-task-status[data-task-status="cancelled"]').length === 3, 'cancelled status icons in ' + viewMode);
   assert(host.querySelectorAll('.dashboard-dataview-task-row .dashboard-task-type').length === 10, 'compact task type icons in ' + viewMode);
   assert(!host.querySelector('.dashboard-dataview-task-checkbox:not(:disabled)'), 'read-only tasks in ' + viewMode);
   labels().find(el => el.textContent === 'cancelled-temporary')!.click(); await tick();
   assert(opened === f.history.path, 'cancelled source opens workspace in ' + viewMode);
  }
  checks.push('all three history states, type icons, readonly rows and source navigation in auto/list/table');
  await toggle('statuses', 'pending'); await toggle('statuses', 'cancelled'); await toggle('types', 'planned');
  assert(labels().map(el => el.textContent).join() === 'deferred-temporary', 'state and type intersection');
  assert(persisted?.taskFilter?.statuses?.join() === 'deferred' && persisted?.taskFilter?.types?.join() === 'temporary', 'filter persists via Markdown');
  refresh(); await tick(); assert(labels().length === 1, 'refresh retains selection');
  mount(persisted!); await tick(); assert(labels().length === 1, 'reopening retains selection');
  await toggle('types', 'temporary');
  assert(labels().length === 0 && !!host.querySelector('.dashboard-task-filters'), 'empty results keep filter controls');
  mount(persisted!); await tick(); assert(labels().length === 0, 'empty selection survives reopening');
  await toggle('types', 'temporary'); assert(labels().length === 1, 'recover from empty filter');
  checks.push('multi-select intersection, serialized persistence, refresh/reopen and recovery from empty results');
  locked = true; const reads = f.reads(); refresh(); await tick();
  assert(reads === f.reads() && host.textContent?.includes('关闭周记加密'), 'locked query never scans');
  locked = false;
  checks.push('encryption guard prevents scanning');
  let saved: DataviewConfig | undefined;
  const modal = new DataviewConfigModal(realApp, config, c => { saved = c; });
  modal.containerEl.addClass('apex-history-filter-modal'); modal.open();
  try {
   const input = modal.contentEl.querySelector('textarea')!;
   input.value = 'TASK WHERE completed'; input.dispatchEvent(new Event('input', {bubbles: true}));
   modal.contentEl.querySelector<HTMLInputElement>('input[data-filter="types"][value="planned"]')!.click();
   (Array.from(modal.contentEl.querySelectorAll('.dashboard-modal-btn--confirm')).at(-1) as HTMLButtonElement).click();
   assert(saved?.query === 'TASK WHERE completed' && saved.openSource === 'workspace' && saved.taskFilter?.types?.join() === 'temporary', 'custom query and filters save together');
   assert(!config.taskFilter?.types, 'cancel/save draft does not mutate input configuration');
  } finally { modal.close(); }
  checks.push('shared settings controls preserve custom DQL and save filters');
  mount(config); await tick();
  const fs = require('fs'), path = require('path'), win = require('@electron/remote').getCurrentWindow();
  await new Promise(resolve => setTimeout(resolve, 150));
  const rect = host.getBoundingClientRect();
  const shot = await Promise.race([win.webContents.capturePage({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.floor(rect.width),height:Math.floor(rect.height)}),new Promise<null>(resolve=>setTimeout(()=>resolve(null),2000))]);
  if (shot) fs.writeFileSync(path.join((globalThis as any).__apexTestOutputDir, 'history-task-filters.png'), shot.toPNG());
  assert(f.writes() === 0, 'no real or fixture task edits');
  return {passed:true, checks, vaultWrites:f.writes(), screenshot:!!shot};
 } finally { host.remove(); }
}
