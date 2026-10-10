(async()=>{
 const c=globalThis.__apexTemplateTest;if(!c)return 'No template fixture';
 const p=app.plugins.plugins['apex-dashboard'],s=p.secure;
 s.mode.enabled=c.originalMode;
 p.settings.workspaceTemplateFile=c.originalTemplate;p.settings.workspaceFolder=c.originalFolder;s.templates.clear();
 // Collect only assets referenced by this test's ciphertext (including partially failed cases).
 for(const f of app.vault.getFiles().filter(f=>f.extension==='apexenc'&&f.basename.startsWith(c.prefix))){
  if(c.originals.has(f.path))throw Error('Refusing original file cleanup');
  c.files.add(f.path);
  if(f.path!==c.template){try{const o=await s.crypto.call('open-all',{text:await app.vault.read(f),password:c.notePassword});for(const r of o.payloads.flatMap(v=>v.assets))c.assets.add(r.id);await s.crypto.call('drop',{token:o.token});}catch{}}
 }
 const leaves=[];app.workspace.iterateAllLeaves(leaf=>leaves.push(leaf));
 for(const leaf of leaves){
  const path=leaf.view.file?.path??leaf.view.workspacePath?.();if(c.files.has(path))await leaf.detach();
 }
 for(const path of c.files){
  if(c.originals.has(path)||(!path.includes(c.prefix)&&!path.startsWith(c.plainAssetDirectory+'/')))throw Error('Cleanup outside synthetic scope');
  const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.delete(file);
 }
 for(const id of c.assets){const file=app.vault.getAbstractFileByPath('周记/_assets/'+id+'.apexasset');if(file)await app.vault.delete(file);}
 for(const path of [c.plainAssetDirectory,c.externalDir?c.externalDir+'/_assets':null,c.externalDir].filter(Boolean)){
  const dir=app.vault.getAbstractFileByPath(path);if(dir&&!dir.children?.length)await app.vault.delete(dir,true);
 }
 const pairs=p.settings.workspaceFiles.map((path,i)=>({path,name:p.settings.workspaceNames?.[i]??''})).filter(x=>!x.path.includes(c.prefix));
 p.settings.workspaceFiles=pairs.map(x=>x.path);p.settings.workspaceNames=pairs.map(x=>x.name);
 await p.saveSettings();
 for(const [path,hash]of c.originals)if(await s.crypto.call('hash',{value:await app.vault.adapter.read(path)})!==hash)throw Error('Original weekly changed');
 if(await app.vault.adapter.read('.apex-weekly-keyring.json')!==c.keyring)throw Error('Original keyring changed');
 if(c.previous)app.workspace.setActiveLeaf(c.previous,{focus:false});
 const report={passed:!!c.passed,checks:c.checks,originalsUnchanged:true,finished:new Date().toISOString()};
 await globalThis.__apexWriteTestReport('encrypted-template-inapp.json',JSON.stringify(report,null,2));
 delete globalThis.__apexTemplateTest;return JSON.stringify(report);
})()
