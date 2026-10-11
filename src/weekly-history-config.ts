import type { DataviewConfig } from './types';

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
 return {query:WEEKLY_HISTORY_QUERY,readOnlyTasks:true,deduplicateLinkedTasks:true,openSource:'workspace'};
}
/** Read legacy files without preserving a second, hard-coded query engine. */
export function normalizeDataviewConfig(config:DataviewConfig):DataviewConfig {
 if(!config.weeklyHistory)return config;
 const {weeklyHistory,...rest}=config;
 return {...rest,...weeklyHistoryConfig(),query:config.query.trim()||WEEKLY_HISTORY_QUERY};
}
