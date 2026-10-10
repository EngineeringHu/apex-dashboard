(async () => {
 const id='apex-dashboard';
 await app.plugins.disablePlugin(id);
 await app.plugins.enablePlugin(id);
 const plugin=app.plugins.plugins[id];
 if(!plugin) throw Error('Plugin reload failed');
 await plugin.secure.crypto.call('domain');
 const crypto=require('crypto'),state=globalThis.__apexWeeklyDeploy;
 if(!state) throw Error('Missing deployment baseline');
 for(const [path,hash] of Object.entries(state.hashes)){
  const file=app.vault.getAbstractFileByPath(path);
  if(!file)throw Error('Missing file after deployment: '+path);
  const current=crypto.createHash('sha256').update(Buffer.from(await app.vault.readBinary(file))).digest('hex');
  if(current!==hash)throw Error('File changed after deployment: '+path);
 }
 const result={reloaded:true,version:plugin.manifest.version,worker:'ok',unchangedNotes:Object.keys(state.hashes).length,encryptionEnabled:plugin.secure.mode.enabled};
 await globalThis.__apexWriteTestReport('weekly-todo-deployment.json',JSON.stringify(result,null,2));
 return JSON.stringify(result);
})()
