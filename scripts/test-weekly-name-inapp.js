(async()=>{
 const p=app.plugins.plugins['apex-dashboard'],s=p.secure;
 if(p.workspaceFolder()!=='周记'||!s.mode.enabled||s.mode.busy||s.mode.pending||s.credentials.busy||s.session.active)throw Error('Test requires idle encrypted weekly mode');
 const marker='__APEX_NAME_TEST_'+require('crypto').randomUUID();
 const password=require('crypto').randomBytes(24).toString('hex');
 const previous=app.workspace.activeLeaf,oldGet=s.credentials.get,oldTemplate=p.settings.workspaceTemplateFile;
 const originals=new Map(),created=new Set(),ownedLeaves=new Set(),sequences=[];
 for(const f of app.vault.getFiles().filter(f=>f.parent?.path==='周记'&&['md','apexenc'].includes(f.extension)))originals.set(f.path,await s.crypto.call('hash',{value:await app.vault.read(f)}));
 const keyring=await app.vault.adapter.read('.apex-weekly-keyring.json');
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,label)=>{for(let i=0;i<250;i++){const result=fn();if(result)return result;await sleep(40);}throw Error('Timeout: '+label);};
 const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
 const count=()=>p.folderWorkspaceFiles().length+s.files().length;
 const number=name=>{const match=name.match(/^(?:第(\d+)周|Week (\d+))/);if(!match)throw Error('Unexpected default weekly name');return Number(match[1]||match[2]);};
 let leaf,overlay;const report={passed:false,checks:[]};
 try{
  const recipient=await s.crypto.call('recipient-create',{password});
  // Use an independent recipient and empty built-in template; never change the real keyring.
  s.credentials.get=async()=>recipient;p.settings.workspaceTemplateFile='';
  const text=await s.crypto.call('create-public',{markdown:'---\ndashboard: true\ncolumns:\n  - name: Test\n    type: memo\n---\n## Test\n### Fixture\nSynthetic\n',title:marker,recipient,definitions:[{name:'Test',sectionType:'memo'}]});
  const seed=await s.store.create(text,marker);created.add(seed);await s.open(seed);
  leaf=await until(()=>app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===seed),'seed view');ownedLeaves.add(leaf);
  async function prompt(){
   app.workspace.setActiveLeaf(leaf,{focus:true});
   const button=await until(()=>leaf.view.contentEl.querySelector('.dashboard-workspace-add-btn'),'new workspace button');
   button.click();
   overlay=await until(()=>leaf.view.contentEl.ownerDocument.querySelector('.dashboard-confirm-overlay'),'name dialog');
   const input=overlay.querySelector('.dashboard-prompt-input');assert(input,'name input');
   return input;
  }
  const first=count()+1;
  for(let i=0;i<2;i++){
   const expected=count()+1,input=await prompt();
   assert(number(input.value)===expected,'Default sequence must include encrypted files');
   assert(expected===first+i,'Continuous encrypted create must increase by one');
   sequences.push(number(input.value));
   const title=input.value+' '+marker+'-'+i,path='周记/'+title+'.apexenc';
   assert(!app.vault.getAbstractFileByPath(path),'Unique synthetic path');
   input.value=title;created.add(path);
   overlay.querySelector('.dashboard-confirm-confirm').click();overlay=null;
   await until(()=>app.vault.getAbstractFileByPath(path)&&s.credentials.creating===0,'encrypted note creation');
   leaf=await until(()=>app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===path),'new protected view');ownedLeaves.add(leaf);
   const encrypted=await s.store.read(path),opened=await s.crypto.call('open-all',{text:encrypted,password});
   assert(opened.markdown.includes('dashboard:'),'New encrypted note decrypts correctly');
   await s.crypto.call('drop',{token:opened.token});
  }
  report.checks.push('Actual new-workspace button increments sequence on two consecutive encrypted creations; both files decrypt with synthetic recipient');
  const plain='周记/'+marker+'.md';created.add(plain);await app.vault.create(plain,'Synthetic plain weekly count fixture');
  const expected=count()+1,input=await prompt();assert(number(input.value)===expected,'Mixed Markdown/encrypted files counted together');
  overlay.querySelector('.dashboard-confirm-cancel').click();overlay=null;
  report.checks.push('Mixed Markdown and encrypted weeklies both contribute to the next name');
  report.sequences=sequences;report.passed=true;
 }catch(error){report.error={message:error.message,stack:error.stack};}
 finally{
  if(overlay?.isConnected)overlay.querySelector('.dashboard-confirm-cancel')?.click();
  s.credentials.get=oldGet;p.settings.workspaceTemplateFile=oldTemplate;
  for(const l of app.workspace.getLeavesOfType('apex-protected-view'))if(created.has(l.view.file?.path))ownedLeaves.add(l);
  for(const path of created){assert(path.startsWith('周记/')&&path.includes(marker)&&!originals.has(path),'Cleanup limited to synthetic paths');if(path.endsWith('.apexenc'))await s.lockFile(path);}
  for(const l of ownedLeaves)await l.detach();
  for(const path of created){const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.delete(f);}
  for(const [path,hash]of originals)assert(await s.crypto.call('hash',{value:await app.vault.adapter.read(path)})===hash,'Original weekly unchanged');
  assert(await app.vault.adapter.read('.apex-weekly-keyring.json')===keyring,'Real keyring unchanged');
  if(previous)app.workspace.setActiveLeaf(previous,{focus:false});
  report.checks.push('Synthetic files removed; original weeklies and keyring unchanged');
  report.finished=new Date().toISOString();
  await globalThis.__apexWriteTestReport('weekly-name-inapp.json',JSON.stringify(report,null,2));
 }
 return JSON.stringify(report);
})()
