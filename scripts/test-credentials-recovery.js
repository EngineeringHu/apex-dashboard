(async()=>{
 const ctx=globalThis.__apexCredentialTest;if(!ctx)throw Error('Missing fixture');const p=app.plugins.plugins['apex-dashboard'],s=p.secure,a=app.vault.adapter;
 const assert=(x,m)=>{if(!x)throw Error(m);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 for(let i=0;i<300&&await a.exists('.apex-weekly-rotation.json');i++)await sleep(40);
 assert(!await a.exists('.apex-weekly-rotation.json'),'restart completed interrupted rotation');assert(!s.credentials.busy,'recovery idle');
 for(const path of ctx.paths){const text=await s.store.read(path),e=JSON.parse(text),opened=await s.crypto.call('open-all',{text,password:ctx.nextPassword});assert(e.version===2,'legacy converted');assert(opened.markdown===ctx.content.get(e.id).markdown&&opened.title===ctx.content.get(e.id).title,'exact content preserved');await s.crypto.call('drop',{token:opened.token});let rejected=false;try{await s.crypto.call('check-password',{text,password:ctx.password});}catch{rejected=true;}assert(rejected,'old password revoked on current file');}
 ctx.checks.push('plugin reload automatically finishes rotation; all legacy/v2 content preserved and only new password accepted');
 const oldPath=ctx.paths.find(path=>/\/[a-f0-9-]{36}\.apexenc$/.test(path)),oldFile=app.vault.getAbstractFileByPath(oldPath),files=s.files;
 s.files=()=>[oldFile];try{
  const restoring=s.credentials.restoreNames();let m;for(let i=0;i<200&&!m;i++){m=Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='验证密码以恢复周记文件名');if(!m)await sleep(30);}assert(m,'filename password dialog');m.querySelector('input').value=ctx.nextPassword;Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='确定').click();await restoring;ctx.paths[ctx.paths.indexOf(oldPath)]=oldFile.path;assert(oldFile.basename==='旧格式-'+ctx.marker,'legacy title restored');
 }finally{s.files=files;}
 const text=await s.store.read(ctx.paths[0]),e=JSON.parse(text);await s.open(ctx.paths[0]);const view=app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===ctx.paths[0]).view;
 const opened=await s.crypto.call('unlock',{text,password:ctx.nextPassword,blockId:e.blocks[1].id});const changed=await s.crypto.call('save-block',{text,token:opened.token,payload:{...opened.payload,raw:opened.payload.raw+'\n'+ctx.marker+'-EDIT'}});await s.store.replace(ctx.paths[0],text,changed);await s.crypto.call('drop',{token:opened.token});
 const verify=await s.crypto.call('open-all',{text:changed,password:ctx.nextPassword});assert(verify.markdown.includes(ctx.marker+'-EDIT'),'new format section edit persisted');await s.crypto.call('drop',{token:verify.token});
 ctx.checks.push('legacy readable filename restored and v2 section editing persists');
 for(const [path,hash]of ctx.originals)assert(await s.crypto.call('hash',{value:await s.store.read(path)})===hash,'user ciphertext unchanged');
 const report={version:p.manifest.version,passed:true,checks:ctx.checks,finished:new Date().toISOString()};await globalThis.__apexWriteTestReport('credentials-inapp.json',JSON.stringify(report,null,2));return JSON.stringify(report);
})()
