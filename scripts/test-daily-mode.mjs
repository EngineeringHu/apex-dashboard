import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, unlink, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import * as format from '../src/secure/format.mjs';

const modules = {
  obsidian: `export class FileSystemAdapter { constructor(base){this.base=base;} getBasePath(){return this.base;} }
    export class TFile { constructor(path,stat){this.path=path;this.stat=stat;this.name=path.split('/').pop();this.basename=this.name.replace(/\\.[^.]+$/,'');this.extension=this.name.split('.').pop();} }
    export class MarkdownView {} export class Notice { constructor(message){globalThis.__notices.push(message);} }`,
  view: `export const DASHBOARD_VIEW_TYPE='dashboard'; export class DashboardView { async flushBeforeEncryption(){} }`,
  popover: `export class NotePopoverModal { static async closeFiles(){} }`,
  cache: `export const invalidatePath=()=>{};`,
  dialogs: `export const askPassword=async()=>globalThis.__password;`,
  runtime: `import { randomUUID } from 'node:crypto'; export const freshId=randomUUID; export const envelope=text=>JSON.parse(text);`,
  cleanup: `export class ProtectedIndexCleanup { install(){} async clean(){} unload(){} }`,
};
const mapped = new Map([['../view','view'],['../note-popover-modal','popover'],['../dql/page-builder','cache'],['../alltasks-scan','cache'],['./dialogs','dialogs'],['./runtime','runtime'],['./index-cleanup','cleanup']]);
await esbuild.build({
  stdin:{contents:"export { DailyEncryptionMode } from './src/secure/daily-mode'; export { FileSystemAdapter, TFile } from 'obsidian';",resolveDir:process.cwd(),sourcefile:'test-daily-mode-entry.ts',loader:'ts'},
  bundle:true, platform:'node', format:'cjs', target:'es2022', outfile:'test-build/daily-mode.cjs', logLevel:'warning',
  plugins:[{name:'daily-mode-isolation',setup(build){
    build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'daily-test'}));
    build.onResolve({filter:/^\./},args=>args.importer.endsWith('/src/secure/daily-mode.ts')&&mapped.has(args.path)?{path:mapped.get(args.path),namespace:'daily-test'}:undefined);
    build.onLoad({filter:/.*/,namespace:'daily-test'},args=>({contents:modules[args.path],loader:'js'}));
  }}],
});
const require=createRequire(import.meta.url);
const { DailyEncryptionMode, FileSystemAdapter, TFile }=require('../test-build/daily-mode.cjs');
const root=await mkdtemp(path.join(os.tmpdir(),'apex-daily-mode-'));
globalThis.__notices=[];globalThis.__password='Synthetic-daily-password';globalThis.document={activeElement:null};
try {
  const files=new Map();let failTarget=null;
  const full=p=>path.join(root,...p.split('/'));
  const adapter=Object.assign(new FileSystemAdapter(root),{
    exists:async p=>access(full(p)).then(()=>true,()=>false),
    read:async p=>readFile(full(p),'utf8'),
    readBinary:async p=>{const b=await readFile(full(p));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},
    write:async(p,s)=>writeFile(full(p),s),
    mkdir:async p=>mkdir(full(p)),
    remove:async p=>unlink(full(p)),
    list:async p=>{const entries=await readdir(full(p),{withFileTypes:true});return {files:entries.filter(e=>e.isFile()).map(e=>`${p}/${e.name}`),folders:entries.filter(e=>e.isDirectory()).map(e=>`${p}/${e.name}`)};},
  });
  const add=async(p,text)=>{await mkdir(path.dirname(full(p)),{recursive:true});await writeFile(full(p),text);const s=await stat(full(p));const f=new TFile(p,{mtime:s.mtimeMs,ctime:s.ctimeMs});files.set(p,f);return f;};
  const vault={
    adapter,getAbstractFileByPath:p=>files.get(p)??null,getFiles:()=>[...files.values()],getMarkdownFiles:()=>[...files.values()].filter(f=>f.extension==='md'),
    create:async(p,text)=>{if(failTarget===p){failTarget=null;throw Error('synthetic publish failure');}if(await adapter.exists(p))throw Error('target exists');return add(p,text);},
    delete:async f=>{await unlink(full(f.path));files.delete(f.path);},
  };
  const app={vault,workspace:{iterateAllLeaves:()=>{}},plugins:{plugins:{}}};
  const recipient=await format.createRecipient(globalThis.__password);
  const crypto={call:async(op,args)=>{
    if(op==='hash')return format.sha256(args.value);
    if(op==='create-daily-public')return format.stringify(await format.createPublicDocument(args.markdown,args.title,args.recipient,args.document));
    if(op==='recipient-validate'){format.checkRecipient(args.recipient);return true;}
    if(op==='open-all'){
      const e=format.parseEnvelope(args.text),opened=await format.openAll(e,await format.resolveRoot(args.password,e));return {...opened,token:'synthetic'};
    }
    if(op==='drop')return true;
    throw Error('unexpected crypto op '+op);
  }};
  const controller={plugin:{app,refreshAllDashboards:()=>{}},crypto,credentials:{assertReady:async()=>{},get:async()=>recipient,creating:0,busy:false},mode:{busy:false},session:{active:false},lockAll:async()=>{},status:()=>{}};
  const mode=new DailyEncryptionMode(controller);
  const original='\uFEFF---\r\ntitle: synthetic\r\n## unfinished fence\r\n```\r\n';
  await add('日记/2026-10-10.md',original);await add('日记/子目录/标题.md','');
  await mode.load();assert.equal(mode.enabled,false);
  await mode.setEnabled(true);
  assert.equal(mode.counts().encrypted,2);assert.equal(mode.counts().plain,0);
  assert.equal(await adapter.exists('日记/2026-10-10.md'),false);
  assert(!(await adapter.read('日记/2026-10-10.apexdaily')).includes('synthetic'));
  const oldCipher=await adapter.read('日记/2026-10-10.apexdaily');
  await add('日记/2026-10-11.md','New plain\n');
  await mode.setEnabled(true);
  assert.equal(mode.counts().encrypted,3);assert.equal(await adapter.read('日记/2026-10-10.apexdaily'),oldCipher);
  await add('日记/2026-10-10.md','Conflicting Calendar note\n');
  await assert.rejects(()=>mode.setEnabled(false),/同名冲突/);
  assert.equal(await adapter.read('日记/2026-10-10.md'),'Conflicting Calendar note\n');
  await vault.delete(files.get('日记/2026-10-10.md'));
  globalThis.__password='wrong';
  await assert.rejects(()=>mode.setEnabled(false),/密码错误|加密文件损坏/);
  assert.equal(await adapter.read('日记/2026-10-10.apexdaily'),oldCipher);
  globalThis.__password='Synthetic-daily-password';
  failTarget='日记/子目录/标题.md';
  await assert.rejects(()=>mode.setEnabled(false),/synthetic publish failure/);
  assert.equal(mode.pending,true);assert.equal(await adapter.exists('日记/2026-10-10.apexdaily'),true);
  const guardedCipher=await adapter.read('日记/子目录/标题.apexdaily');
  await adapter.write('日记/子目录/标题.apexdaily','externally modified');
  await assert.rejects(()=>mode.resume(),/外部修改/);
  assert.equal(await adapter.read('日记/子目录/标题.apexdaily'),'externally modified');
  await adapter.write('日记/子目录/标题.apexdaily',guardedCipher);
  await mode.resume();
  assert.equal(mode.pending,false);assert.equal(mode.enabled,false);assert.equal(mode.counts().encrypted,0);
  assert.equal(await adapter.read('日记/2026-10-10.md'),original);
  assert.equal(await adapter.read('日记/子目录/标题.md'),'');
  assert.equal(await adapter.read('日记/2026-10-11.md'),'New plain\n');
  console.log('daily mode: raw round-trip, nested/empty, manual new, conflict, wrong password, external edit, interrupted resume passed');
} finally {await rm(root,{recursive:true,force:true});}
