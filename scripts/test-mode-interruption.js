(async()=>{
 const c=globalThis.__apexModeTest;if(!c)throw Error('No fixture');const s=app.plugins.plugins['apex-dashboard'].secure,a=app.vault.adapter;
 const files=s.files;s.files=()=>files.call(s).filter(f=>f.basename.startsWith(c.prefix));const publish=s.mode.publish.bind(s.mode);let count=0;
 s.mode.publish=async(...args)=>{if(++count===2)throw Error('SYNTHETIC_MODE_INTERRUPT');return publish(...args);};
 try{
  let failure;const action=s.mode.setEnabled(false).catch(e=>failure=e);let modal;
  for(let i=0;i<200&&!modal;i++){modal=Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='关闭周记加密：转换为普通 Markdown');if(!modal)await new Promise(r=>setTimeout(r,30));}
  if(!modal)throw Error('Password prompt missing');modal.querySelector('input').value=c.password;Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='确定').click();await action;
  if(failure?.message!=='SYNTHETIC_MODE_INTERRUPT'||!s.mode.pending||!await a.exists('.apex-weekly-mode-change.json'))throw Error('Recovery journal missing');
  for(const [path,hash]of c.encrypted)if(await s.crypto.call('hash',{value:await a.read(path)})!==hash)throw Error('Encrypted source changed before all outputs verified');
  c.checks.push('injected conversion write failure retains every encrypted source and persistent recovery journal');return 'Interrupted conversion safeguards passed';
 }finally{s.files=files;s.mode.publish=publish;}
})()
