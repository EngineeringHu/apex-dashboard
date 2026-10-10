import * as crypto from './format.mjs';
const tokens=new Map();
let chain=Promise.resolve();
export function receive(request,send){chain=chain.then(async()=>{
  try { send({id:request.id,result:await run(request.op,request.args)}); }
  catch(error) {send({id:request.id,error:error.message||'加密操作失败'});}
});}
async function run(op,a) {
  if(op==='create') return crypto.stringify(await crypto.createNote(a.markdown,a.title,a.password,a.domain,a.definitions,a.assets));
  if(op==='create-public') return crypto.stringify(await crypto.createPublic(a.markdown,a.title,a.recipient,a.definitions,a.assets));
  if(op==='recipient-create') return crypto.createRecipient(a.password);
  if(op==='recipient-check'){await crypto.unlockRecipient(a.password,a.recipient);return true;}
  if(op==='recipient-validate'){crypto.checkRecipient(a.recipient);return true;}
  if(op==='migrate-recipient')return crypto.stringify(await crypto.migrateRecipient(crypto.parseEnvelope(a.text),a.password,a.recipient,a.newPassword));
  if(op==='read-title'){const e=crypto.parseEnvelope(a.text),root=await crypto.resolveRoot(a.password,e);return (await crypto.openBlock(e,root,e.blocks[0].id)).payload.title;}
  if(op==='domain') return crypto.newDomain();
  if(op==='hash') return crypto.sha256(a.value);
  if(op==='asset-encrypt') return crypto.encryptAsset(new Uint8Array(a.bytes));
  if(op==='asset-decrypt') return crypto.decryptAsset(a.asset,a.ref);
  if(op==='drop'){tokens.delete(a.token);return true;}
  if(op==='clear'){tokens.clear();return true;}
  if(op==='check-password') {const e=crypto.parseEnvelope(a.text),root=await crypto.resolveRoot(a.password,e);await crypto.openBlock(e,root,e.blocks[0].id);return true;}
  if(op==='unlock') {
    const e=crypto.parseEnvelope(a.text),root=await crypto.resolveRoot(a.password,e);
    const {payload,key}=await crypto.openBlock(e,root,a.blockId),token=crypto.id();
    const info=await crypto.openBlock(e,root,e.blocks[0].id);
    tokens.set(token,{key,fileId:e.id,blockId:a.blockId,infoKey:info.key});
    return {payload,token,info:info.payload};
  }
  if(op==='save-board'){
    let e=crypto.parseEnvelope(a.text);
    for(const patch of a.patches){
      const handle=tokens.get(patch.token);
      if(!handle||handle.fileId!==e.id||handle.blockId!==patch.id)throw Error('分区已锁定，修改未保存');
      e=await crypto.replaceBlock(e,patch.id,handle.key,patch.payload);
    }
    if(a.layout){
      const root=await crypto.resolveRoot(a.password,e);
      e=await crypto.changeLayout(e,root,a.layout,a.infoPayload);
    }else if(a.infoPayload){
      const handle=tokens.get(a.infoToken);
      if(!handle||handle.fileId!==e.id||!handle.infoKey)throw Error('请先解锁一个分区');
      e=await crypto.replaceBlock(e,e.blocks[0].id,handle.infoKey,a.infoPayload);
    }
    return crypto.stringify(e);
  }
  if(op==='save-block') {
    const e=crypto.parseEnvelope(a.text),handle=tokens.get(a.token);
    if(!handle || handle.fileId!==e.id) throw Error('解锁会话已过期');
    return crypto.stringify(await crypto.replaceBlock(e,handle.blockId,handle.key,a.payload));
  }
  if(op==='open-all') {
    const e=crypto.parseEnvelope(a.text);let root,privateKey;
    const cached=tokens.get(a.domainToken);
    if(e.version===2){
      const recipient=JSON.stringify(e.access.recipient);
      privateKey=cached?.recipient===recipient?cached.privateKey:await crypto.unlockRecipient(a.password,e.access.recipient);
      root=await crypto.resolveRoot(a.password,e,privateKey);
    }else if(cached?.version===1&&cached.domain===JSON.stringify(e.domain))root=cached.root;
    else root=await crypto.resolveRoot(a.password,e);
    const opened=await crypto.openAll(e,root),token=crypto.id();
    tokens.set(token,{root,domain:JSON.stringify(e.domain),fileId:e.id,version:e.version,privateKey,recipient:e.access?JSON.stringify(e.access.recipient):undefined});
    return {...opened,token};
  }
  if(op==='save-all') {
    const e=crypto.parseEnvelope(a.text),handle=tokens.get(a.token);
    if(!handle||handle.fileId!==e.id)throw Error('整篇会话已过期');
    return crypto.stringify(await crypto.createWithRoot(a.markdown,a.title,handle.root,e.domain,a.definitions,a.assets,e.id,e.access));
  }
  throw Error('未知加密操作');
}
