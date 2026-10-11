import type { TFile } from 'obsidian';
/** Per-view context for every DQL section; no history-specific filtering. */
export interface WeeklyHistoryContext {
 folder:string;
 currentPath:string;
 templatePath?:string;
 unavailable:()=>boolean;
 open:(file:TFile)=>Promise<void>;
}
