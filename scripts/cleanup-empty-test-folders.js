(async()=>{const a=app.vault.adapter,fs=require('fs/promises'),path=require('path'),base=await fs.realpath(a.getBasePath()),cleaned=[];
 if(await a.exists('.apex-protected-session.json')||await a.exists('.apex-weekly-mode-change.json'))throw Error('Unfinished operation');
 const candidates=['__apex-selftest__','周记/_临时解密','周记/_附件'];
 for(const root of ['.apex-weekly-mode-staging'])if(await a.exists(root)){for(const folder of (await a.list(root)).folders)candidates.push(folder);candidates.push(root);}
 for(const relative of candidates){if(!await a.exists(relative))continue;const target=path.resolve(base,relative),rel=path.relative(base,target);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw Error('Outside workspace');if((await fs.lstat(target)).isSymbolicLink())continue;const list=await a.list(relative);if(!list.files.length&&!list.folders.length){await fs.rmdir(target);cleaned.push(relative);}}
 return JSON.stringify({removedEmptyDirectories:cleaned.length});})()
