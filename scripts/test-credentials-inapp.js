(async()=>{
 const s=app.plugins.plugins['apex-dashboard'].secure,a=app.vault.adapter;
 if(s.session.active||globalThis.__apexCredentialTest||await a.exists('.apex-weekly-keyring.json')||await a.exists('.apex-weekly-rotation.json'))throw Error('Existing credential/session state; refusing fixture setup');
 const originals=new Map();for(const f of s.files())originals.set(f.path,await s.crypto.call('hash',{value:await app.vault.read(f)}));
 const ctx=globalThis.__apexCredentialTest={originals,paths:[],previous:app.workspace.activeLeaf,password:'7汉!',nextPassword:'9文!',marker:'CREDENTIAL_TEST_'+require('crypto').randomUUID(),checks:[]};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(x,m)=>{if(!x)throw Error(m);};
 const until=async(fn,label)=>{for(let i=0;i<300;i++){const x=fn();if(x)return x;await sleep(40);}throw Error('Timeout: '+label);};
 const modal=title=>until(()=>Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent===title),title);
 const submit=(m,value)=>{m.querySelectorAll('input').forEach(i=>i.value=value);Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='确定').click();};
 const files=s.files;s.files=()=>files.call(s).filter(f=>ctx.paths.includes(f.path));
 try{
  let failure;const setting=s.credentials.setup().catch(e=>failure=e);
  const m=await modal('设置统一周记密码');submit(m,'ab');await sleep(100);assert(m.isConnected&&m.textContent.includes('至少 3'),'two characters rejected');submit(m,ctx.password);await setting;if(failure)throw failure;
  assert(await a.exists('.apex-weekly-keyring.json'),'configuration persisted');ctx.config=await a.read('.apex-weekly-keyring.json');assert(!ctx.config.includes(ctx.password),'no plaintext password in config');ctx.checks.push('settings setup rejects 2 characters and accepts 3; config has no plaintext password');
  const title='第99周-10月1号-'+ctx.marker;
  for(let i=0;i<2;i++){
   const before=new Set(app.vault.getFiles().map(f=>f.path));
   await s.create(title);
   const created=app.vault.getFiles().filter(f=>f.extension==='apexenc'&&!before.has(f.path));assert(created.length===1,'one new file');ctx.paths.push(created[0].path);
   assert(created[0].basename===title+(i?'-2':''),'readable collision-safe filename');
   assert(!document.querySelector('.modal input[type=password]'),'no creation password prompt');
   const e=JSON.parse(await app.vault.read(created[0]));assert(e.version===2,'public-key format');
   const view=app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===created[0].path).view;
   assert(view.getDisplayText()===created[0].basename,'tab uses full filename');assert(app.plugins.plugins['apex-dashboard'].getWorkspaceChoices().some(x=>x.path===created[0].path&&x.label.includes(title)),'switcher uses readable name');
   const arrow=await until(()=>view.contentEl.querySelector('.dashboard-section-toggle'),'locked row');arrow.click();submit(await modal('解锁分区'),ctx.password);await until(()=>view.contentEl.querySelector('[data-secure-locked=false]'),'unlocked');await s.lockFile(created[0].path);
  }
  ctx.checks.push('real new-note command path never asks password; duplicate names get suffix; full name in tab/switcher; 3-character password unlocks sections');
  const old=await s.crypto.call('create',{markdown:'## Legacy\n'+ctx.marker+'\n',title:'旧格式-'+ctx.marker,password:ctx.password});ctx.paths.push(await s.store.create(old));
  ctx.checks.push('legacy v1 fixture prepared for password migration');
  await s.lockAll();return JSON.stringify({passed:true,phase:'configured-and-created',checks:ctx.checks});
 }finally{s.files=files;}
})()
