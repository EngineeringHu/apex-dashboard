(async()=>{
 const p=app.plugins.plugins['apex-dashboard'],s=p.secure,a=app.vault.adapter;
 if(s.mode.pending||s.mode.busy||s.session.active||globalThis.__apexModeTest)throw Error('Existing operation; refusing test');
 const prefix='__APEX_MODE_TEST_'+require('crypto').randomUUID(),password='8测!';
 const originals=new Map();for(const f of [...s.files(),...s.mode.plainFiles()])originals.set(f.path,await s.crypto.call('hash',{value:await app.vault.read(f)}));
 const c=globalThis.__apexModeTest={prefix,password,originals,assets:[],previous:app.workspace.activeLeaf,originalDashboard:p.settings.dashboardFile,originalMode:await a.exists('.apex-weekly-mode.json')?await a.read('.apex-weekly-mode.json'):null,checks:[],recipient:await s.crypto.call('recipient-create',{password})};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(x,m)=>{if(!x)throw Error(m);};
 const until=async(fn,label)=>{for(let i=0;i<300;i++){const value=fn();if(value)return value;await sleep(40);}throw Error('Timeout '+label);};
 const dialog=()=>until(()=>Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='关闭周记加密：转换为普通 Markdown'),'mode password');
 const submit=(m,value)=>{m.querySelector('input').value=value;Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='确定').click();};
 const files=s.files,plain=s.mode.plainFiles,get=s.credentials.get;
 s.files=()=>files.call(s).filter(f=>f.basename.startsWith(prefix));s.mode.plainFiles=()=>plain.call(s.mode).filter(f=>f.basename.startsWith(prefix));s.credentials.get=async()=>c.recipient;
 const md='---\ndashboard: true\ncolumns:\n  - name: 周计划表\n    type: table\n---\n\n## 周计划表\n\n| 周计划 | > | 周一 |\n| --- | --- | --- |\n| 角色 | 目标 | 任务 |\n| 测试 | ➤ | - [ ] '+prefix+' |\n';
 try{
  const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'));
  const ref=await s.store.putAsset(bytes,prefix+'.png','![[fixture.png]]','image/png');c.assets.push(ref.id);
  for(let i=0;i<2;i++){const text=await s.crypto.call('create-public',{markdown:md+(i?'':'\n'+ref.link+'\n'),title:prefix+'-'+i,recipient:c.recipient,assets:i?[]:[ref],definitions:[{name:'周计划表',sectionType:'table',color:'#8d6e63'}]});await s.store.create(text,prefix+'-'+i);}
  const originalPlain=await app.vault.create('周记/'+prefix+'-0.md','## 原有同名文件\nMUST_KEEP\n');
  let failed;let action=s.mode.setEnabled(false).catch(e=>failed=e);const cancel=await dialog();Array.from(cancel.querySelectorAll('button')).find(b=>b.textContent==='取消').click();await action;assert(!failed&&s.files().length===2,'cancel preserves originals');
  action=s.mode.setEnabled(false).catch(e=>failed=e);submit(await dialog(),'wrong');await action;assert(failed&&s.files().length===2&&!s.mode.pending,'wrong password deletes nothing');
  failed=null;action=s.mode.setEnabled(false).catch(e=>failed=e);submit(await dialog(),password);await action;if(failed)throw failed;
  assert(!s.mode.enabled&&s.files().length===0&&s.mode.plainFiles().length===3,'all fixtures became real md');assert(await app.vault.read(originalPlain)==='## 原有同名文件\nMUST_KEEP\n','existing same name untouched');
  const converted=s.mode.plainFiles().find(f=>f.basename===prefix+'-0-2');assert(converted,'collision adds suffix');const body=await app.vault.read(converted);assert(body.includes(prefix)&&body.includes('周记/_附件/'),'body and attachment link restored');
  const path=body.match(/!\[\[([^\]]+)\]\]/)[1];assert(await a.exists(path),'attachment restored');c.assetPath=path;
  await until(()=>s.mode.plainFiles().every(f=>app.metadataCache.getFileCache(f)),'native metadata index');const dv=app.plugins.plugins.dataview;if(dv)await until(()=>s.mode.plainFiles().every(f=>dv.index.pages.has(f.path)),'Dataview normal index');
  c.checks.push('cancel/wrong password preserve originals; close switch creates real Markdown and attachment files, avoids same-name overwrite, native metadata and Dataview index normally');
  await s.create(prefix+'-NEW');assert(s.mode.plainFiles().some(f=>f.basename===prefix+'-NEW'),'new note follows off mode');assert(!document.querySelector('.modal input[type=password]'),'ordinary create asks no password');
  await app.vault.modify(converted,body.replace('- [ ]','- [x]')+'\nEDIT_IN_NORMAL_MODE\n');
  await s.lockAll();assert(await a.exists(converted.path),'lock does not encrypt normal md');c.checks.push('off mode persists normal editing and new md creation; locking does not reencrypt');
  if(!await a.exists('__apex-selftest__'))await app.vault.createFolder('__apex-selftest__');const shared=await app.vault.create('__apex-selftest__/'+prefix+'.md','![['+path+']]');
  let refused=false;try{await s.mode.setEnabled(true);}catch(e){refused=e.message.includes('共用');}assert(refused&&await a.exists(path)&&s.mode.plainFiles().length===4,'shared attachment blocks before removing originals');await app.vault.delete(shared,true);
  await s.mode.setEnabled(true);assert(s.mode.enabled&&s.mode.plainFiles().length===0&&s.files().length===4,'on encrypts all normal notes');assert(!await a.exists(path),'private plaintext attachment removed after encryption');
  let foundEdit=false;for(const f of s.files()){const opened=await s.crypto.call('open-all',{text:await app.vault.read(f),password});foundEdit||=opened.markdown.includes('EDIT_IN_NORMAL_MODE');for(const ref of opened.payloads.flatMap(p=>p.assets))if(!c.assets.includes(ref.id))c.assets.push(ref.id);await s.crypto.call('drop',{token:opened.token});}assert(foundEdit,'normal edits survive encryption');
  if(dv)assert([...dv.index.pages.keys()].every(path=>!path.includes(prefix)||!path.endsWith('.md')),'Dataview plaintext index removed');
  const removed=['apex-dashboard:protected-unlock-all','apex-dashboard:protected-unlock-all-assets','apex-dashboard:protected-cancel'];assert(removed.every(id=>!app.commands.commands[id]),'old temporary commands removed');
  c.checks.push('shared attachments fail safely; enabling encrypts edited/new md and private attachments; Dataview plaintext index cleaned; old temporary commands absent');
  const snapshots=[];for(const f of s.files())snapshots.push([f.path,await s.crypto.call('hash',{value:await app.vault.read(f)})]);c.encrypted=snapshots;
  await s.lockAll();return JSON.stringify({passed:true,checks:c.checks});
 }finally{s.files=files;s.mode.plainFiles=plain;s.credentials.get=get;}
})()
