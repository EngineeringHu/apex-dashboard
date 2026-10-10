import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {Worker} from 'node:worker_threads';
import {mkdir,writeFile} from 'node:fs/promises';
const worker=new Worker(new URL('../dist/secure-worker.cjs',import.meta.url));let seq=0;
const call=(op,args={})=>new Promise((resolve,reject)=>{const id=++seq;const handler=m=>{if(m.id!==id)return;worker.off('message',handler);m.error?reject(Error(m.error)):resolve(m.result);};worker.on('message',handler);worker.postMessage({id,op,args});});
const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();
const password='Synthetic-benchmark-password';
const markdown='---\ntitle: benchmark\n---\n## Weekly\n'+('synthetic text, no private information\n'.repeat(1000));
const startRss=process.memoryUsage().rss;let peakRss=startRss;
const start=performance.now();let firstUnlockMs=0;
try{
 const domain=await call('domain');const first=await call('create',{markdown,title:'benchmark',password,domain});
 const t=performance.now();const full=await call('open-all',{text:first,password});firstUnlockMs=performance.now()-t;
 for(let i=0;i<520;i++){
   const encoded=await call('save-all',{text:first,token:full.token,markdown,title:'benchmark',assets:[],definitions:[]});
   const decoded=await call('open-all',{text:encoded,password:'',domainToken:full.token});
   if(decoded.markdown!==markdown)throw Error('benchmark roundtrip failed');await call('drop',{token:decoded.token});
   peakRss=Math.max(peakRss,process.memoryUsage().rss);
 }
 await call('clear');
 histogram.disable();
 const result={date:new Date().toISOString(),runtime:process.version,scope:'Node worker only; NOT Obsidian UI, native indexing or another computer',documents:520,textBytesEach:Buffer.byteLength(markdown),wallMs:Math.round(performance.now()-start),firstUnlockMs:Math.round(firstUnlockMs),parentLoopP95Ms:Math.round(histogram.percentile(95)/1e6),parentLoopMaxMs:Math.round(histogram.max/1e6),peakProcessRssIncrementMiB:Math.round((peakRss-startRss)/1024/1024)};
 await mkdir(new URL('../test-output',import.meta.url),{recursive:true});await writeFile(new URL('../test-output/benchmark.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{histogram.disable();await worker.terminate();}
