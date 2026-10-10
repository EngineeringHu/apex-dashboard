(async()=>{
 const c=globalThis.__apexTemplateTest;if(!c?.stage1)throw Error('Missing stage 1 fixture');
 const p=app.plugins.plugins['apex-dashboard'],s=p.secure,oldGet=s.credentials.get;
 const sleep=ms=>new Promise(r=>require('timers').setTimeout(r,ms));
 const assert=(v,msg)=>{if(!v)throw Error(msg);};
 const until=async(fn,label)=>{for(let i=0;i<250;i++){const v=fn();if(v)return v;await sleep(40);}throw Error('Timeout '+label);};
 const unlock=async()=>{const modal=await until(()=>Array.from(activeDocument.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='解锁加密看板模板（本次会话有效）'),'password after restart');modal.querySelector('input').value=c.password;Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='确定').click();};
 const originalRegistry={files:[...p.settings.workspaceFiles],names:p.settings.workspaceNames?[...p.settings.workspaceNames]:[],active:p.settings.dashboardFile};
 let plainPath='',normalMode=s.mode.enabled;
 try{
  assert(!s.templates.cached,'Plugin reload discards template cache');
  p.settings.workspaceTemplateFile=c.template;
  let read=s.templates.read();await unlock();const snapshot=await read;assert(snapshot?.markdown===c.markdown,'Unlock after reload');
  c.checks.push('plugin reload clears cache and requests template password again');

  // Test ordinary creation with the mode flag scoped to this synthetic operation; no real conversion.
  s.mode.enabled=false;
  const title=c.prefix+'-plain';plainPath='周记/'+title+'.md';c.files.add(plainPath);
  await p.createWorkspace(title);
  const plain=await app.vault.read(app.vault.getAbstractFileByPath(plainPath));
  assert(plain.includes(c.secret),'Normal board receives decrypted template body');
  assert(/\|120\]\]/.test(plain),'Wiki image alias preserved');
  const links=[...plain.matchAll(/!\[\[([^|\]]+)/g)];
  assert(links.length===1,'Image link rewritten');
  for(const match of links){
   const f=app.vault.getAbstractFileByPath(match[1]);assert(f,'Exported image exists');
   c.files.add(f.path);c.plainAssetDirectory=f.parent.path;
   assert(JSON.stringify(Array.from(new Uint8Array(await app.vault.readBinary(f))))===JSON.stringify(c.image),'Plain image matches');
  }
  s.mode.enabled=normalMode;
  c.checks.push('ordinary-mode create exports a Markdown board and decrypted attachment, preserving image alias');

  const external=c.prefix+'/template.apexenc';c.externalDir=c.prefix;
  await app.vault.createFolder(c.prefix);await app.vault.createFolder(c.prefix+'/_assets');
  await app.vault.create(external,c.cipher);c.files.add(external);
  const assetPath=c.prefix+'/_assets/'+c.sourceAsset+'.apexasset';await app.vault.create(assetPath,c.assetText);c.files.add(assetPath);
  p.settings.workspaceTemplateFile=external;s.templates.clear();
  read=s.templates.read();await unlock();assert((await read)?.markdown===c.markdown,'Template in another folder with adjacent encrypted assets');
  c.checks.push('encrypted template outside weekly folder reads adjacent _assets');


  const beforeFailure=new Set(app.vault.getAllLoadedFiles().map(f=>f.path));
  const failedPath='周记/'+c.prefix+'-write-failure.md',vaultCreate=app.vault.create;
  s.mode.enabled=false;
  app.vault.create=async function(path,...args){if(path===failedPath)throw Error('Synthetic template write failure');return vaultCreate.call(this,path,...args);};
  try{await p.createWorkspace(c.prefix+'-write-failure');}finally{app.vault.create=vaultCreate;s.mode.enabled=normalMode;}
  assert(!app.vault.getAbstractFileByPath(failedPath),'Failed write publishes no board');
  assert(app.vault.getAllLoadedFiles().every(f=>beforeFailure.has(f.path)),'Failed write rolls back its exported files and empty directory');
  c.checks.push('injected Markdown write failure rolls back exported attachments and their empty directory');

  p.settings.workspaceTemplateFile=c.prefix+'/missing.apexenc';s.templates.clear();
  s.mode.enabled=true;
  let failed=false;try{await s.create(c.prefix+'-missing');}catch{failed=true;}
  assert(failed&&!app.vault.getAbstractFileByPath('周记/'+c.prefix+'-missing.apexenc'),'Missing cipher template cannot silently create blank board');
  const settings=await app.vault.adapter.read(p.manifest.dir+'/data.json');assert(!settings.includes(c.secret),'Decrypted template not persisted in settings');
  c.checks.push('missing encrypted template fails without creating blank board; no plaintext template in settings');
  c.passed=true;
 }finally{
  s.mode.enabled=normalMode;s.credentials.get=oldGet;p.settings.workspaceTemplateFile=c.originalTemplate;p.settings.workspaceFolder=c.originalFolder;s.templates.clear();
  p.settings.workspaceFiles=originalRegistry.files;p.settings.workspaceNames=originalRegistry.names;p.settings.dashboardFile=originalRegistry.active;
  await p.saveSettings();await p.repointAllViews();
 }
 return JSON.stringify({passed:true,checks:c.checks});
})()
