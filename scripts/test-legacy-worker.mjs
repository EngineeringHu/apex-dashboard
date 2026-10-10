import {Worker} from 'node:worker_threads';
import assert from 'node:assert/strict';
import * as format from '../src/secure/format.mjs';
const worker=new Worker(new URL('../fixtures/secure1-worker.cjs',import.meta.url));
let seq=0;
const call=(op,args)=>new Promise((resolve,reject)=>{const id=++seq;const fn=m=>{if(m.id!==id)return;worker.off('message',fn);m.error?reject(Error(m.error)):resolve(m.result);};worker.on('message',fn);worker.postMessage({id,op,args});});
try{
 const password='Synthetic-legacy-password',markdown='\uFEFF---\r\ntitle: 合成兼容测试\r\n---\r\n## 周记\r\n- [ ] Test\r\n';
 const oldText=await call('create',{markdown,title:'合成测试',password});
 const e=format.parseEnvelope(oldText),root=await format.deriveRoot(password,e.domain);
 assert.equal((await format.openAll(e,root)).markdown,markdown);
 const current=format.stringify(await format.createNote(markdown,'合成测试',password));
 assert.equal((await call('open-all',{text:current,password})).markdown,markdown);
 console.log(JSON.stringify({passed:true,checks:'secure.1 → secure.2 offline decrypt; secure.2 → secure.1 decrypt; exact Chinese BOM/CRLF preservation'}));
}finally{await worker.terminate();}
