import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
const root=path.dirname(fileURLToPath(import.meta.url));
await esbuild.build({absWorkingDir:root,entryPoints:['scripts/test-session.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',alias:{obsidian:path.join(root,'scripts/secure-obsidian-stub.ts')},outfile:path.join(root,'test-build/session.cjs'),logLevel:'warning'});
await esbuild.build({absWorkingDir:root,entryPoints:['scripts/verify-weekly-todo.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',alias:{obsidian:path.join(root,'scripts/obsidian-stub.ts')},outfile:path.join(root,'test-build/weekly-todo.cjs'),logLevel:'warning'});
await esbuild.build({absWorkingDir:root,entryPoints:['scripts/verify-linked-tasks.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',alias:{obsidian:path.join(root,'scripts/obsidian-stub.ts')},outfile:path.join(root,'test-build/linked-tasks.cjs'),logLevel:'warning'});
await esbuild.build({absWorkingDir:root,entryPoints:['scripts/verify-weekly-history.ts'],bundle:true,platform:'node',format:'cjs',alias:{obsidian:path.join(root,'scripts/obsidian-stub.ts')},outfile:path.join(root,'test-build/weekly-history.cjs'),logLevel:'warning'});
await esbuild.build({absWorkingDir:root,entryPoints:['scripts/verify-history-dql.ts'],bundle:true,platform:'node',format:'cjs',alias:{obsidian:path.join(root,'scripts/obsidian-stub.ts')},outfile:path.join(root,'test-build/history-dql.cjs'),logLevel:'warning'});
for(const file of ['test-build/history-dql.cjs','test-build/weekly-history.cjs','scripts/test-crypto.mjs','scripts/test-daily-mode.mjs','test-build/session.cjs','scripts/test-offline-tools.mjs','test-build/weekly-todo.cjs','test-build/linked-tasks.cjs']){const result=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
