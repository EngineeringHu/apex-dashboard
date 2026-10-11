// Shared by browser Web Workers and the standalone Node.js 20+ recovery script.
const webcrypto = globalThis.crypto;
const subtle = webcrypto.subtle;
const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const FORMAT = 'apex-protected';
export const VERSION = 1;
export const ITERATIONS = 600000;
export const MAX_NOTE_BYTES = 4 * 1024 * 1024;
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 12 * 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedKinds = new Set(['info', 'table', 'text']);
export const encode = b => {
  const input = new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength);
  let binary = '';
  for (let i = 0; i < input.length; i += 8192) binary += String.fromCharCode(...input.subarray(i, i + 8192));
  return btoa(binary);
};
export function decode(s, max = MAX_CONTAINER_BYTES) {
  if (typeof s !== 'string' || s.length % 4 || s.length > Math.ceil(max/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error('无效的加密数据编码');
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
const bytes = s => utf8.encode(s);
const rand = n => webcrypto.getRandomValues(new Uint8Array(n));
export const id = () => webcrypto.randomUUID();
export const newDomain = () => ({ salt: encode(rand(32)), iterations: ITERATIONS });
export function checkDomain(d) {
  if (!d || !Number.isInteger(d.iterations) || d.iterations < ITERATIONS || d.iterations > 2000000 || decode(d.salt,32).length !== 32) throw Error('不支持的口令派生参数');
}
export async function deriveRoot(password, domain) {
  checkDomain(domain);
  if (typeof password !== 'string' || password.length > 1024) throw Error('口令格式错误');
  const input = bytes(password);
  const material = await subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  input.fill(0);
  const raw = await subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:decode(domain.salt), iterations:domain.iterations}, material, 256);
  const root = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  new Uint8Array(raw).fill(0);
  return root;
}
async function purpose(root, fileId, label) {
  return subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:bytes(fileId),info:bytes('apex-protected/v1/'+label)},root,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const importAes = raw => subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
function aad(e,label) { return bytes(JSON.stringify([FORMAT,e.version,e.id,e.domain.salt,e.domain.iterations,label])); }
async function seal(key, raw, additionalData) {
  const nonce = rand(12);
  const ciphertext = await subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData,tagLength:128},key,raw);
  return {nonce:encode(nonce),ciphertext:encode(ciphertext)};
}
async function unseal(key, box, additionalData, max = MAX_CONTAINER_BYTES) {
  if (!box || decode(box.nonce,12).length !== 12) throw Error('密文 nonce 无效');
  try { return new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:decode(box.nonce),additionalData,tagLength:128},key,decode(box.ciphertext,max))); }
  catch { throw Error('密码错误或加密文件损坏，原文件未更改'); }
}
export function parseEnvelope(text) {
  if (typeof text !== 'string' || bytes(text).length > MAX_CONTAINER_BYTES) throw Error('加密周记超过大小限制');
  const e = JSON.parse(text);
  if (e.format !== FORMAT || ![1,2].includes(e.version) || !uuidPattern.test(e.id) || !Array.isArray(e.blocks) || !e.blocks.length || e.blocks.length > 512) throw Error('不支持的加密周记格式');
  checkDomain(e.domain);
  if(e.version===2){checkRecipient(e.access?.recipient);if(JSON.stringify(e.domain)!==JSON.stringify(e.access.recipient.domain)||decode(e.access.wrappedRoot,384).length!==384)throw Error('周记密钥配置不匹配');}
  const seen = new Set();
  for (const b of e.blocks) {
    if (!uuidPattern.test(b.id) || seen.has(b.id) || !allowedKinds.has(b.kind)) throw Error('分区清单不合法');
    seen.add(b.id);
    for (const box of [b.key,b.data]) if (!box || decode(box.nonce,12).length !== 12 || decode(box.ciphertext).length < 16) throw Error('加密块不完整');
  }
  if (e.blocks[0].kind !== 'info' || e.blocks.slice(1).some(b=>b.kind==='info')) throw Error('文档信息块不合法');
  return e;
}
export const stringify = e => JSON.stringify(e)+'\n';
async function verify(e,root) {
  const m = JSON.parse(decoder.decode(await unseal(await purpose(root,e.id,'manifest'),e.manifest,aad(e,'manifest'))));
  if (JSON.stringify(m) !== JSON.stringify(e.blocks.map(b=>[b.id,b.kind]))) throw Error('分区清单认证失败');
}
async function sign(e,root) {
  e.manifest = await seal(await purpose(root,e.id,'manifest'),bytes(JSON.stringify(e.blocks.map(b=>[b.id,b.kind]))),aad(e,'manifest'));
}
export function splitMarkdown(markdown) {
  if (bytes(markdown).length > MAX_NOTE_BYTES) throw Error('周记超过 4 MiB，请先拆分');
  const starts=[]; let offset=0, fence='', width=0, front=false;
  for (const [i,line] of markdown.split(/(?<=\n)/).entries()) {
    const plain=line.replace(/\r?\n$/,'');
    if (i===0 && plain.replace(/^\uFEFF/,'')==='---') {front=true;offset+=line.length;continue;}
    if (front) { if (/^(---|\.\.\.)\s*$/.test(plain)) front=false; offset+=line.length;continue; }
    const f=plain.match(/^ {0,3}(`{3,}|~{3,})/);
    if (f) {if (!fence) {fence=f[1][0];width=f[1].length;} else if (f[1][0]===fence && f[1].length>=width) fence='';}
    else if (!fence && /^##\s+\S/.test(plain)) starts.push(offset);
    offset+=line.length;
  }
  if (front || fence) throw Error('未闭合的 frontmatter 或代码块，请先修正');
  const chunks=[{kind:'info',raw:markdown.slice(0,starts[0]??markdown.length)}];
  for(let i=0;i<starts.length;i++) {
    const raw=markdown.slice(starts[i],starts[i+1]??markdown.length);
    chunks.push({kind:/^\s*\|.+\|\s*$/m.test(raw)?'table':'text',raw});
  }
  return chunks;
}
export async function createNote(markdown,title,password,domain=newDomain(),definitions=[],assetRefs=[]) {
  checkNewPassword(password);
  const root=await deriveRoot(password,domain);
  return createWithRoot(markdown,title,root,domain,definitions,assetRefs);
}
export async function createWithRoot(markdown,title,root,domain,definitions=[],assetRefs=[],fileId=id(),access=null,document=null) {
  const e={format:FORMAT,version:access?2:1,id:fileId,domain,blocks:[],manifest:null,...(access?{access}:{})};
  const chunks=document?[{kind:'info',raw:markdown}]:splitMarkdown(markdown);
  if(bytes(markdown).length>MAX_NOTE_BYTES)throw Error('文档超过 4 MiB，请先拆分');
  for(let i=0;i<chunks.length;i++) {
    const chunk=chunks[i], blockId=id(), rawKey=rand(32), key=await importAes(rawKey);
    const payload={raw:chunk.raw, ...(i===0?{title}:{}), ...(i===0&&document?{document}:{}), definition:definitions[i-1]??null, assets:assetRefs.filter(a=>chunk.raw.includes(a.link))};
    const keyBox=await seal(await purpose(root,e.id,'wrap/'+blockId),rawKey,aad(e,'key/'+blockId+'/'+chunk.kind));
    rawKey.fill(0);
    const data=await seal(key,bytes(JSON.stringify(payload)),aad(e,'data/'+blockId+'/'+chunk.kind));
    e.blocks.push({id:blockId,kind:chunk.kind,key:keyBox,data});
  }
  await sign(e,root); return e;
}
export async function openBlock(e,root,blockId) {
  await verify(e,root);
  const b=e.blocks.find(b=>b.id===blockId); if(!b) throw Error('分区不存在');
  const rawKey=await unseal(await purpose(root,e.id,'wrap/'+b.id),b.key,aad(e,'key/'+b.id+'/'+b.kind),48);
  if(rawKey.length!==32) throw Error('内容密钥不合法');
  const key=await importAes(rawKey);rawKey.fill(0);
  const raw=await unseal(key,b.data,aad(e,'data/'+b.id+'/'+b.kind));
  const payload=JSON.parse(decoder.decode(raw));raw.fill(0);
  if(typeof payload.raw!=='string' || !Array.isArray(payload.assets)) throw Error('分区内容格式错误');
  return {payload,key};
}
export async function replaceBlock(e,blockId,key,payload) {
  if(bytes(payload.raw).length>MAX_NOTE_BYTES) throw Error('分区过大');
  const b=e.blocks.find(b=>b.id===blockId);if(!b) throw Error('分区不存在');
  const next=structuredClone(e);
  next.blocks.find(b=>b.id===blockId).data=await seal(key,bytes(JSON.stringify(payload)),aad(e,'data/'+b.id+'/'+b.kind));
  return next;
}
export async function changeLayout(e,root,layout,infoPayload) {
  await verify(e,root);
  if(!Array.isArray(layout)||layout.length>511)throw Error('分区数量超出限制');
  const next=structuredClone(e), seen=new Set(), blocks=[next.blocks[0]];
  for(const item of layout){
    if(item.id){
      const block=next.blocks.find(b=>b.id===item.id&&b.kind!=='info');
      if(!block||seen.has(item.id))throw Error('分区结构已发生变化');
      seen.add(item.id);blocks.push(block);
    }else{
      const scratch=await createWithRoot(item.payload.raw,'',root,e.domain,[item.payload.definition],item.payload.assets,e.id,e.access);
      if(scratch.blocks.length!==2)throw Error('新分区必须只有一个二级标题');
      blocks.push(scratch.blocks[1]);
    }
  }
  next.blocks=blocks;
  const info=await openBlock(e,root,e.blocks[0].id);
  const updated=await replaceBlock(next,e.blocks[0].id,info.key,infoPayload);
  await sign(updated,root);return updated;
}
export async function openAll(e,root) {
  await verify(e,root); const payloads=[];
  for(const block of e.blocks) payloads.push((await openBlock(e,root,block.id)).payload);
  return {markdown:payloads.map(p=>p.raw).join(''),title:payloads[0].title,payloads};
}
// Public-key creation lets every synced computer encrypt a new note without
// retaining a password or a key capable of decrypting existing notes.
export function checkNewPassword(password){if(typeof password!=='string'||[...password].length<3||password.length>1024)throw Error('密码至少 3 个字符，最多 1024 个字符');}
export function checkRecipient(r){
  if(!r||r.format!=='apex-weekly-recipient'||r.version!==1||!uuidPattern.test(r.id))throw Error('统一密码配置无效');
  checkDomain(r.domain);
  if(decode(r.publicKey,1024).length<384||decode(r.privateKey?.nonce,12).length!==12||decode(r.privateKey?.ciphertext,4096).length<1000)throw Error('统一密码密钥不完整');
}
const recipientAad=r=>bytes(JSON.stringify(['apex-weekly-recipient',1,r.id,r.domain.salt,r.domain.iterations,r.publicKey]));
export async function createRecipient(password){
  checkNewPassword(password);
  const pair=await subtle.generateKey({name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
  const r={format:'apex-weekly-recipient',version:1,id:id(),domain:newDomain(),publicKey:encode(await subtle.exportKey('spki',pair.publicKey)),privateKey:null};
  const raw=new Uint8Array(await subtle.exportKey('pkcs8',pair.privateKey));
  try{const root=await deriveRoot(password,r.domain);r.privateKey=await seal(await purpose(root,r.id,'recipient-private'),raw,recipientAad(r));}finally{raw.fill(0);}
  await unlockRecipient(password,r);return r;
}
export async function unlockRecipient(password,r){
  checkRecipient(r);const root=await deriveRoot(password,r.domain);
  const raw=await unseal(await purpose(root,r.id,'recipient-private'),r.privateKey,recipientAad(r),4096);
  try{
    const key=await subtle.importKey('pkcs8',raw,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
    // Authenticate that the published public key matches the encrypted private key.
    const pub=await subtle.importKey('spki',decode(r.publicKey,1024),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const sample=rand(32),box=await subtle.encrypt({name:'RSA-OAEP'},pub,sample);
    if(encode(await subtle.decrypt({name:'RSA-OAEP'},key,box))!==encode(sample))throw Error('统一密码公私钥不匹配');
    return key;
  }finally{raw.fill(0);}
}
const importRoot=raw=>subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
export async function resolveRoot(password,e,privateKey=null){
  if(e.version===1)return deriveRoot(password,e.domain);
  const key=privateKey??await unlockRecipient(password,e.access.recipient);
  const raw=new Uint8Array(await subtle.decrypt({name:'RSA-OAEP',label:bytes('apex-note-root/v2/'+e.id)},key,decode(e.access.wrappedRoot,384)));
  try{if(raw.length!==32)throw Error('周记密钥无效');return await importRoot(raw);}finally{raw.fill(0);}
}
async function newAccess(recipient,fileId){
  checkRecipient(recipient);
  const pub=await subtle.importKey('spki',decode(recipient.publicKey,1024),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']),raw=rand(32);
  try{return {root:await importRoot(raw),access:{recipient,wrappedRoot:encode(await subtle.encrypt({name:'RSA-OAEP',label:bytes('apex-note-root/v2/'+fileId)},pub,raw))}};}finally{raw.fill(0);}
}
export async function createPublic(markdown,title,recipient,definitions=[],assets=[]){
  const fileId=id(),{root,access}=await newAccess(recipient,fileId);
  const e=await createWithRoot(markdown,title,root,recipient.domain,definitions,assets,fileId,access);
  if((await openAll(e,root)).markdown!==markdown)throw Error('新建密文往返校验失败');
  return e;
}
/** One authenticated raw block preserves diary Markdown without parsing headings or fences. */
export async function createPublicDocument(markdown,title,recipient,document){
  if(!document||document.kind!=='daily'||document.version!==1||typeof document.path!=='string'||!document.path.startsWith('日记/')||!document.path.endsWith('.md')||document.path.includes('\\')||document.path.includes(':')||document.path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||!Number.isFinite(document.mtime)||!Number.isFinite(document.ctime))throw Error('日记元数据无效');
  const fileId=id(),{root,access}=await newAccess(recipient,fileId);
  const e=await createWithRoot(markdown,title,root,recipient.domain,[],[],fileId,access,document);
  const opened=await openAll(e,root);
  if(opened.markdown!==markdown||JSON.stringify(opened.payloads[0].document)!==JSON.stringify(document))throw Error('日记密文往返校验失败');
  return e;
}
export async function migrateRecipient(e,password,recipient,newPassword){
  const oldRoot=await resolveRoot(password,e),opened=await openAll(e,oldRoot),{root,access}=await newAccess(recipient,e.id);
  const next={...e,version:2,domain:recipient.domain,access,blocks:[]};
  for(let i=0;i<e.blocks.length;i++){
    const b=e.blocks[i],raw=rand(32),key=await importAes(raw);
    try{next.blocks.push({...b,key:await seal(await purpose(root,e.id,'wrap/'+b.id),raw,aad(next,'key/'+b.id+'/'+b.kind)),data:await seal(key,bytes(JSON.stringify(opened.payloads[i])),aad(next,'data/'+b.id+'/'+b.kind))});}finally{raw.fill(0);}
  }
  await sign(next,root);
  const verified=await openAll(next,await resolveRoot(newPassword,next));
  if(JSON.stringify(verified)!==JSON.stringify(opened))throw Error('统一密码迁移校验失败');
  return next;
}
export async function encryptAsset(input) {
  if(input.byteLength>MAX_ASSET_BYTES) throw Error('首版附件上限 32 MiB');
  const assetId=id(),rawKey=rand(32),key=await importAes(rawKey);
  const asset={format:'apex-asset',version:VERSION,id:assetId,data:await seal(key,input,bytes('apex-asset/v1/'+assetId))};
  const secret=encode(rawKey);rawKey.fill(0);
  return {asset,key:secret};
}
export async function decryptAsset(asset,ref) {
  if(asset.format!=='apex-asset'||asset.version!==VERSION||asset.id!==ref.id||!uuidPattern.test(asset.id)) throw Error('附件身份不匹配');
  const raw=decode(ref.key,32);if(raw.length!==32)throw Error('附件密钥无效');
  const key=await importAes(raw);raw.fill(0);
  return unseal(key,asset.data,bytes('apex-asset/v1/'+asset.id),MAX_ASSET_BYTES+16);
}
export async function sha256(input) { return encode(await subtle.digest('SHA-256',typeof input==='string'?bytes(input):input)); }
