(async()=>{
 const secure=app.plugins.plugins['apex-dashboard'].secure;
 if(secure.session.active||app.workspace.getLeavesOfType('apex-protected-view').length)throw Error('Benchmark requires no protected views or session');
 const text='## Synthetic benchmark\n'+('synthetic text, no private information\n'.repeat(1000));
 const password=require('crypto').randomBytes(24).toString('hex');
 const start=performance.now(),gaps=[];let last=start;
 const timer=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},10);
 let result;
 try {
  const first=await secure.crypto.call('create',{markdown:text,title:'synthetic benchmark',password});
  const t=performance.now(),all=await secure.crypto.call('open-all',{text:first,password}),unlockMs=performance.now()-t;
  for(let i=0;i<100;i++){
   const encoded=await secure.crypto.call('save-all',{text:first,token:all.token,markdown:text,title:'synthetic benchmark',assets:[],definitions:[]});
   const decoded=await secure.crypto.call('open-all',{text:encoded,domainToken:all.token});
   if(decoded.markdown!==text)throw Error('roundtrip mismatch');await secure.crypto.call('drop',{token:decoded.token});
  }
  gaps.sort((a,b)=>a-b);
  result={passed:true,date:new Date().toISOString(),scope:'actual Obsidian Web Worker; no disk I/O or batch Dataview indexing',documents:100,bytesEach:new TextEncoder().encode(text).length,totalMs:Math.round(performance.now()-start),firstUnlockMs:Math.round(unlockMs),uiTimerGapP95Ms:Math.round(gaps[Math.floor(gaps.length*.95)]??0),uiTimerGapMaxMs:Math.round(Math.max(...gaps)),electron:process.versions.electron};
 }finally{clearInterval(timer);secure.crypto.stop();}
 await globalThis.__apexWriteTestReport('benchmark-inapp.json',JSON.stringify(result,null,2));return JSON.stringify(result);
})()
