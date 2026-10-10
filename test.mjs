import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';
const root=path.dirname(fileURLToPath(import.meta.url));
await esbuild.build({absWorkingDir:root,entryPoints:['scripts/test-session.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',alias:{obsidian:path.join(root,'scripts/secure-obsidian-stub.ts')},outfile:path.join(root,'test-build/session.cjs'),logLevel:'warning'});
for(const file of ['scripts/test-crypto.mjs','test-build/session.cjs','scripts/test-offline-tools.mjs']){const result=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
