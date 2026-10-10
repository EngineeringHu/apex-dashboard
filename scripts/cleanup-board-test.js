(async()=>{const c=globalThis.__apexBoardTest;if(!c)return 'No synthetic board test';const s=app.plugins.plugins['apex-dashboard'].secure;
 if(c.path){if(c.originals.has(c.path)||!/^周记\/[a-f0-9-]+\.apexenc$/.test(c.path))throw Error('Invalid synthetic path');await s.lockFile(c.path);if(c.leaf)await c.leaf.detach();const f=app.vault.getAbstractFileByPath(c.path);if(f)await app.vault.delete(f);}
 for(const [path,hash]of c.originals){if(await s.crypto.call('hash',{value:await s.store.read(path)})!==hash)throw Error('Existing protected note changed');}
 if(c.previous)app.workspace.setActiveLeaf(c.previous,{focus:false});delete globalThis.__apexBoardTest;return 'Synthetic board removed; existing encrypted notes unchanged';})()
