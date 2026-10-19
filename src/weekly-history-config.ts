import type { DataviewConfig } from './types';
import { normalizeTaskFilter, type TaskFilter } from './task-filter';

export const WEEKLY_HISTORY_QUERY = [
 'TASK',
 'FROM "周记"',
 'WHERE dashboard AND file.folder = "周记"',
 'WHERE !completed AND weekStart',
 'WHERE weekStart <= this.weekStart AND weekStart <= date("sow")',
 'WHERE file.path != this.file.path',
 'SORT weekStart DESC, file.name ASC',
 'GROUP BY file.link',
].join('\n');

export function weeklyHistoryConfig():DataviewConfig {
 return {query:WEEKLY_HISTORY_QUERY,readOnlyTasks:true,deduplicateLinkedTasks:true,openSource:'workspace',taskFilter:historyTaskFilter()};
}
function historyTaskFilter():TaskFilter { return {statuses:['pending','deferred','cancelled']}; }
/** Read legacy files without preserving a second, hard-coded query engine. */
export function normalizeDataviewConfig(config:DataviewConfig):DataviewConfig {
 const {weeklyHistory,...rest}=config;
 const query=weeklyHistory ? config.query.trim()||WEEKLY_HISTORY_QUERY : config.query;
 // Upgrade only the built-in preset's defaults. Custom query text and explicit
 // selections (including an empty selection) always survive loading/saving.
 const builtIn=query.replace(/\s+/g,' ').trim()===WEEKLY_HISTORY_QUERY.replace(/\s+/g,' ');
 const taskFilter=normalizeTaskFilter(config.taskFilter) ?? (builtIn ? historyTaskFilter() : undefined);
 return {...rest,...(weeklyHistory ? {readOnlyTasks:true,deduplicateLinkedTasks:true,openSource:'workspace' as const} : {}),query,taskFilter};
}
