(async()=>{
 const p=app.plugins.plugins['apex-dashboard'],s=p.secure;
 if(globalThis.__apexTemplateTest||s.mode.busy||s.mode.pending||s.session.active||p.workspaceFolder()!=='周记')throw Error('Need idle encrypted weekly mode');
 const prefix='__APEX_TEMPLATE_TEST_'+require('crypto').randomUUID(),secret='TEMPLATE_SECRET_'+require('crypto').randomUUID();
 const c=globalThis.__apexTemplateTest={prefix,secret,template:'周记/'+prefix+'.apexenc',password:require('crypto').randomBytes(24).toString('hex'),notePassword:require('crypto').randomBytes(24).toString('hex'),files:new Set(),assets:new Set(),previous:app.workspace.activeLeaf,originalMode:s.mode.enabled,originalTemplate:p.settings.workspaceTemplateFile,originalFolder:p.settings.workspaceFolder,originals:new Map(),checks:[],pending:null};
 for(const f of app.vault.getFiles().filter(f=>f.parent?.path==='周记'&&['md','apexenc'].includes(f.extension)))c.originals.set(f.path,await s.crypto.call('hash',{value:await app.vault.read(f)}));
 c.keyring=await app.vault.adapter.read('.apex-weekly-keyring.json');
 const oldGet=s.credentials.get;
 const sleep=ms=>new Promise(r=>require('timers').setTimeout(r,ms));
 const until=async(fn,label)=>{for(let i=0;i<250;i++){const value=fn();if(value)return value;await sleep(40);}throw Error('Timeout '+label);};
 const assert=(v,msg)=>{if(!v)throw Error(msg);};
 const unlock=async(value,cancel=false)=>{
  const modal=await until(()=>Array.from(activeDocument.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='解锁加密看板模板（本次会话有效）'),'template password');
  if(!cancel)modal.querySelector('input').value=value;
  Array.from(modal.querySelectorAll('button')).find(b=>b.textContent===(cancel?'取消':'确定')).click();
  await until(()=>!modal.isConnected,'password dialog closed');await sleep(200);
 };
 const start=title=>{c.phase=title;const operation=s.create(title).then(()=>null,error=>error);c.pending=operation;return operation;};
 try{
  s.mode.enabled=true;
  c.recipient=await s.crypto.call('recipient-create',{password:c.notePassword});s.credentials.get=async()=>c.recipient;
  const recipient=await s.crypto.call('recipient-create',{password:c.password});
  c.image=[137,80,78,71,1,2,3,4];
  const ref=await s.store.putAsset(Uint8Array.from(c.image),'模板图片.png','![[模板图片.png|120]]','image/png');
  c.assets.add(ref.id);c.sourceAsset=ref.id;c.assetText=await app.vault.adapter.read('周记/_assets/'+ref.id+'.apexasset');
  c.markdown='---\ndashboard: true\ncolumns:\n  - name: 周计划表\n    type: table\n    height: 642\n  - name: 不断更新\n    type: todo\n---\n## 周计划表\n| 目标 | 周一 |\n| --- | --- |\n| '+secret+' | - [ ] task |\n'+ref.link+'\n## 不断更新\n### 模板任务\n- [ ] '+secret+'\n';
  c.cipher=await s.crypto.call('create-public',{markdown:c.markdown,title:prefix,recipient,definitions:[{name:'周计划表',sectionType:'table',height:642},{name:'不断更新',sectionType:'todo'}],assets:[ref]});
  await app.vault.create(c.template,c.cipher);c.files.add(c.template);
  p.settings.workspaceTemplateFile=c.template;s.templates.clear();
  assert(s.templates.file()?.path===c.template,'Explicit .apexenc resolves');
  p.settings.workspaceTemplateFile=c.template.slice(0,-8);
  assert(s.templates.file()?.path===c.template,'Extensionless encrypted-only template resolves');
  p.settings.workspaceTemplateFile=c.template;
  assert(!s.workspaceFiles().some(f=>f.path===c.template),'Template excluded from weekly picker/count');
  assert(!p.getWorkspaceChoices().some(f=>f.path===c.template),'Template excluded from banner picker');
  c.checks.push('explicit/extensionless .apexenc template resolves and is excluded from weekly choices');

  let task=start(prefix+'-wrong');await unlock('wrong-password');assert(await task,'Wrong password rejects');
  assert(!s.templates.cached,'Wrong password is not cached');
  task=start(prefix+'-cancel');await unlock('',true);assert(await task===null,'Cancel returns without creating');
  assert(s.files().filter(f=>f.basename.startsWith(prefix)).length===1,'Wrong password/cancel creates no board');

  for(let i=0;i<2;i++){
   const title=prefix+'-new-'+i,path='周记/'+title+'.apexenc';c.files.add(path);
   task=start(title);if(i===0)await unlock(c.password);
   const error=await Promise.race([task,sleep(10000).then(()=>Error('Repeated create requested another password or stalled'))]);if(error)throw error;
   const text=await s.store.read(path),opened=await s.crypto.call('open-all',{text,password:c.notePassword});
   assert(opened.markdown===c.markdown,'Template Markdown copied exactly');
   assert(opened.payloads[1].definition.sectionType==='table'&&opened.payloads[1].definition.height===642,'Table type/height preserved');
   assert(opened.payloads[2].definition.sectionType==='todo','Todo section preserved');
   for(const asset of opened.payloads.flatMap(v=>v.assets)){assert(asset.id!==ref.id,'Attachment cloned under fresh key/id');c.assets.add(asset.id);assert(JSON.stringify(Array.from(await s.store.getAsset(asset)))===JSON.stringify(c.image),'Attachment content preserved');}
   await s.crypto.call('drop',{token:opened.token});
   assert(!text.includes(secret),'No plaintext in new cipher');
  }
  assert(!!s.templates.cached,'Template retained only in session cache');
  assert(!app.vault.getMarkdownFiles().some(f=>f.basename.startsWith(prefix)),'Encrypted creation writes no temporary Markdown');
  c.checks.push('wrong password/cancel do not create files; first unlock followed by two encrypted creations without a second prompt; exact layout/body and fresh encrypted attachments');

  s.templates.clear();task=start(prefix+'-locked');await unlock('',true);await task;
  assert(!app.vault.getAbstractFileByPath('周记/'+prefix+'-locked.apexenc'),'Manual lock requires unlocking again');
  task=s.templates.read().then(v=>v,error=>error);await unlock(c.password);const snapshot=await task;if(snapshot instanceof Error)throw snapshot;
  await app.vault.modify(app.vault.getAbstractFileByPath(c.template),c.cipher+'\n');
  assert(!s.templates.cached,'Modifying template invalidates session cache');
  task=s.templates.read().then(v=>v,error=>error);await unlock(c.password);const changed=await task;if(changed instanceof Error)throw changed;
  c.checks.push('manual template lock and template modification invalidate cache');
  c.stage1=true;
  return JSON.stringify({passed:true,checks:c.checks,next:'Reload plugin, then run test-template-restart.js'});
 }finally{
  s.mode.enabled=c.originalMode;s.credentials.get=oldGet;
  p.settings.workspaceTemplateFile=c.originalTemplate;
  p.settings.workspaceFolder=c.originalFolder;
 }
})()
