(async()=>{
  const plugin=app.plugins.plugins['apex-dashboard'], secure=plugin.secure;
  const fs=require('fs'), path=require('path'), root=app.vault.adapter.getBasePath();
  const reportPath=path.join(globalThis.__apexTestOutputDir,'inapp-basic.json');
  const checks=[], report={started:new Date().toISOString(),version:plugin.manifest.version,checks};
  const originalConsoleError=console.error, errors=[];
  console.error=(...args)=>{errors.push(args.map(x=>x instanceof Error?x.stack:String(x)).join(' '));originalConsoleError.apply(console,args);};
  const password=require('crypto').randomBytes(24).toString('hex');
  const marker='APEX_SYNTHETIC_'+require('crypto').randomUUID();
  const originalTemplate=plugin.settings.workspaceTemplateFile, previousLeaf=app.workspace.activeLeaf;
  const before=new Set(secure.files().map(f=>f.path));let created=null,leaf=null;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const until=async(fn,label)=>{for(let i=0;i<400;i++){const found=fn();if(found)return found;await sleep(50);}throw Error('Timeout: '+label);};
  const button=(node,label)=>Array.from(node.querySelectorAll('button')).find(b=>b.textContent===label);
  const dialog=title=>Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent===title);
  async function fill(title,values){const m=await until(()=>dialog(title),'dialog '+title);const inputs=m.querySelectorAll('input');assert(inputs.length===values.length,'input count '+title);values.forEach((v,i)=>{inputs[i].value=v;inputs[i].dispatchEvent(new Event('input',{bubbles:true}));});const ok=button(m,'确定');assert(ok,'confirm button '+title);ok.click();await until(()=>!dialog(title),'dialog close');}
  async function unlock(node,value=password){button(node,'展开并解锁').click();await fill('解锁分区',[value]);}
  try {
    assert(!secure.session.active,'A plaintext session is already active');
    assert(before.size===0,'Use an empty protected test environment; no existing user encrypted notes');
    assert(!document.querySelector('.modal-container'),'A user modal is open');
    plugin.settings.workspaceTemplateFile='';
    assert(app.commands.executeCommandById('apex-dashboard:protected-new'),'new command exists');
    await fill('新建加密周记名称',[marker]);
    await fill('设置周记口令',[password,password]);
    created=await until(()=>secure.files().find(f=>!before.has(f.path)),'created encrypted file');
    leaf=await until(()=>app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===created.path),'protected view');
    const view=leaf.view;
    await until(()=>view.contentEl.querySelector('.apex-protected-section'),'locked content');
    let ciphertext=await app.vault.read(created), envelope=JSON.parse(ciphertext);
    assert(!ciphertext.includes(marker),'title must be encrypted');
    assert(!view.contentEl.querySelector('textarea'),'new note starts locked');checks.push('command → name → repeated password → ciphertext file → locked view');
    const block=envelope.blocks.find(b=>b.kind==='table');assert(block,'table block exists');
    let node=view.contentEl.querySelector('[data-secure-id="'+block.id+'"]');
    await unlock(node,'incorrect-synthetic-password');
    await until(()=>Array.from(document.querySelectorAll('.notice')).some(n=>n.textContent.includes('密码错误')),'wrong password notice');
    assert(!node.querySelector('table')&&!node.querySelector('textarea'),'wrong password leaves content locked');checks.push('wrong password cannot reveal a section');
    await unlock(node);
    await until(()=>node.querySelector('table'),'decrypted weekly table');checks.push('correct password renders actual weekly table');
    button(node,'编辑分区 Markdown').click();
    const editor=await until(()=>node.querySelector('textarea'),'section editor');
    editor.value=editor.value.replace('| 个体：个人 | ➤ |  |','| 个体：个人 | ➤ | TASK_'+marker+' |')+'\n'+marker+'\n';
    assert(editor.value.includes('TASK_'+marker),'test task inserted into weekly table');editor.dispatchEvent(new Event('input',{bubbles:true}));
    button(node,'收起并锁定').click();
    await until(()=>button(node,'展开并解锁'),'section relocked');
    assert(!node.querySelector('textarea')&&!node.textContent.includes(marker),'collapse clears plaintext DOM');
    ciphertext=await app.vault.read(created);assert(!ciphertext.includes(marker),'edited disk file remains ciphertext');
    await unlock(node);await until(()=>node.querySelector('input[type="checkbox"]'),'table task checkbox');
    const checkbox=node.querySelector('input[type="checkbox"]');checkbox.click();await sleep(650);
    button(node,'收起并锁定').click();await until(()=>button(node,'展开并解锁'),'table task relocked');
    await unlock(node);await until(()=>node.querySelector('input[type="checkbox"]'),'saved task checkbox');
    assert(node.querySelector('input[type="checkbox"]').checked,'table task checkbox persisted');
    button(node,'编辑分区 Markdown').click();assert(node.querySelector('textarea').value.includes('[x] TASK_'+marker),'task Markdown persisted');checks.push('section edit and real table checkbox → encrypted save → password again → persisted content');
    button(view.contentEl,'整篇 Markdown').click();await fill('打开整篇 Markdown',[password]);
    const whole=await until(()=>view.contentEl.querySelector('textarea'),'whole editor');
    assert(whole.value.includes(marker),'whole Markdown includes saved section');
    whole.value+='\nWHOLE_'+marker+'\n';whole.dispatchEvent(new Event('input',{bubbles:true}));
    await sleep(800);button(view.contentEl,'保存并锁定').click();
    await until(()=>!view.contentEl.querySelector('textarea'),'whole locked');
    checks.push('whole Markdown edit → auto-save → lock');
    await leaf.detach();leaf=null;
    await secure.open(created.path);leaf=await until(()=>app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===created.path),'reopened view');
    assert(!leaf.view.contentEl.querySelector('textarea'),'reopen starts locked');
    button(leaf.view.contentEl,'整篇 Markdown').click();await fill('打开整篇 Markdown',[password]);
    const reopened=await until(()=>leaf.view.contentEl.querySelector('textarea'),'reopened whole editor');
    assert(reopened.value.includes('WHOLE_'+marker),'whole edit persisted after close');checks.push('close → reopen → password required → whole edit persisted');
    await secure.lockFile(created.path);
    const token=await secure.crypto.call('open-all',{text:await app.vault.read(created),password});
    assert(token.markdown.includes('WHOLE_'+marker),'independent worker read matches');await secure.crypto.call('drop',{token:token.token});
    app.commands.executeCommandById('apex-dashboard:protected-unlock-all');
    await fill('临时解密全部：此期间磁盘可读明文',[password]);
    await until(()=>secure.session.active&&!secure.session.busy&&secure.session.journal?.entries.length===1,'plaintext session ready');
    const work=secure.session.journal.entries[0].work, workFile=app.vault.getAbstractFileByPath(work);
    assert(workFile,'real plaintext Markdown exists');
    assert((await app.vault.read(workFile)).includes('WHOLE_'+marker),'plaintext matches encrypted edit');
    await until(()=>app.metadataCache.getFileCache(workFile),'native metadata index');
    const dv=app.plugins.plugins.dataview;
    if(dv){await until(()=>dv.index.pages.has(work),'Dataview real index');checks.push('temporary Markdown is indexed by native metadata and Dataview');}
    await app.vault.modify(workFile,(await app.vault.read(workFile))+'\nTEMP_'+marker+'\n');
    await secure.session.finish();
    assert(!secure.session.active&&!await app.vault.adapter.exists(work),'plaintext session removed');
    if(dv){assert(!dv.index.pages.has(work),'Dataview plaintext index cleared');const keys=await dv.index.persister.persister.keys();assert(!keys.includes('file:'+work),'Dataview persistent cache cleared');}
    const afterTemp=await secure.crypto.call('open-all',{text:await app.vault.read(created),password});
    assert(afterTemp.markdown.includes('TEMP_'+marker),'temporary edit re-encrypted');await secure.crypto.call('drop',{token:afterTemp.token});
    checks.push('temporary plaintext edit → re-encrypt → file and Dataview caches removed');
    assert(!errors.length,'Unexpected application error: '+errors.join('\n'));report.passed=true;
  } catch(e) {report.passed=false;report.error={message:e.message,stack:e.stack};}
  finally {
    console.error=originalConsoleError;
    plugin.settings.workspaceTemplateFile=originalTemplate;
    try {if(secure.session.active)throw Error('Synthetic session preserved for debugging; source must not be deleted');if(created){await secure.lockFile(created.path);if(leaf)await leaf.detach();await app.vault.delete(created);}secure.crypto.stop();if(previousLeaf)app.workspace.setActiveLeaf(previousLeaf,{focus:false});report.cleaned=true;}catch(e){report.cleanupError=e.message;report.cleaned=false;}
    report.finished=new Date().toISOString();fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  }
  return JSON.stringify(report);
})()
