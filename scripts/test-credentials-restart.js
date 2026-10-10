(async()=>{
 const ctx=globalThis.__apexCredentialTest;if(!ctx)throw Error('Missing credential fixture');
 const s=app.plugins.plugins['apex-dashboard'].secure,a=app.vault.adapter;
 const assert=(x,m)=>{if(!x)throw Error(m);},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(fn,label)=>{for(let i=0;i<400;i++){const x=fn();if(x)return x;await sleep(30);}throw Error('Timeout '+label);};
 const dialog=async(title,value)=>{const m=await until(()=>Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent===title),title);m.querySelectorAll('input').forEach(i=>i.value=value);Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='确定').click();};
 const files=s.files;s.files=()=>files.call(s).filter(f=>ctx.paths.includes(f.path));
 try{
  const before=new Set(app.vault.getFiles().map(f=>f.path));await s.create('重载后-'+ctx.marker);
  const file=app.vault.getFiles().find(f=>f.extension==='apexenc'&&!before.has(f.path));assert(file,'creation after reload');ctx.paths.push(file.path);
  assert(!document.querySelector('.modal input[type=password]'),'reload creation has no password prompt');
  ctx.checks.push('fresh plugin instance creates with synced config only, no cached password or unlock token');
  const snapshot=new Map();for(const path of ctx.paths){const text=await s.store.read(path),opened=await s.crypto.call('open-all',{text,password:ctx.password});snapshot.set(JSON.parse(text).id,{markdown:opened.markdown,title:opened.title});await s.crypto.call('drop',{token:opened.token});}ctx.content=snapshot;
  let failure;const replacement=s.store.replace.bind(s.store);let count=0;
  s.store.replace=async(...args)=>{if(++count===2)throw Error('SYNTHETIC interrupted rotation');return replacement(...args);};
  try{
   const rotation=s.credentials.setup().catch(e=>failure=e);await dialog('验证当前统一密码',ctx.password);await dialog('设置新的统一周记密码',ctx.nextPassword);await rotation;
   assert(failure?.message==='SYNTHETIC interrupted rotation','intentional interruption');assert(await a.exists('.apex-weekly-rotation.json'),'durable recovery journal');
   assert(await a.read('.apex-weekly-keyring.json')===ctx.config,'config published only after all notes updated');
   const journal=JSON.parse(await a.read('.apex-weekly-rotation.json'));const first=await s.store.read(journal.entries[0].path);await s.crypto.call('check-password',{text:first,password:ctx.nextPassword});
   let blocked=false;try{await s.credentials.assertReady();}catch{blocked=true;}assert(blocked,'new operations blocked during incomplete rotation');
   ctx.checks.push('password rotation validates legacy and v2 files; injected write failure leaves recoverable ciphertext journal and blocks unsafe operations');
  }finally{s.store.replace=replacement;}
  return JSON.stringify({passed:true,phase:'interrupted-rotation',checks:ctx.checks});
 }finally{s.files=files;}
})()
