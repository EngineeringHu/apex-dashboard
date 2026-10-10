#!/usr/bin/env node
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { parseEnvelope, resolveRoot, openAll, decryptAsset } from '../src/secure/format.mjs';

function passwordPrompt() {
  if(!process.stdin.isTTY)throw Error('请在交互式终端运行，密码不能放在命令行参数中');
  return new Promise((resolve,reject)=>{
    let value='';process.stdout.write('口令（不回显）: ');
    emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
    const finish=()=>{process.stdin.off('keypress',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
    const handler=(s,key)=>{if(key?.ctrl&&key.name==='c'){finish();reject(Error('已取消'));}else if(key?.name==='return'){finish();resolve(value);value='';}else if(key?.name==='backspace')value=value.slice(0,-1);else if(!key?.ctrl&&s)value+=s;};
    process.stdin.on('keypress',handler);
  });
}
function inside(root,target){const r=path.relative(root,target);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
async function absent(target){try{await access(target);throw Error('拒绝覆盖已有输出: '+target);}catch(e){if(e.code!=='ENOENT')throw e;}}
try{
  const argv=process.argv.slice(2),input=argv[0];
  if(!input||argv.includes('--help')){console.log('用法: node decrypt-weekly.mjs <文件.apexenc> --verify\n或: node decrypt-weekly.mjs <文件.apexenc> --output <库外文件.md> [--with-assets]');process.exit(0);}
  const outputIndex=argv.indexOf('--output'),output=outputIndex>=0?argv[outputIndex+1]:null;
  if(!argv.includes('--verify')&&!output)throw Error('请提供 --verify 或 --output');
  const file=path.resolve(input),e=parseEnvelope(await readFile(file,'utf8'));
  let password=await passwordPrompt();const root=await resolveRoot(password,e);password='';
  const opened=await openAll(e,root),refs=new Map();
  for(const p of opened.payloads)for(const ref of p.assets)refs.set(ref.id,ref);
  const assets=[];
  for(const ref of refs.values()){
    const asset=JSON.parse(await readFile(path.join(path.dirname(file),'_assets',ref.id+'.apexasset'),'utf8'));
    assets.push({ref,bytes:await decryptAsset(asset,ref)});
  }
  if(argv.includes('--verify')){console.log('验证成功：正文及 '+assets.length+' 个附件认证通过。');process.exit(0);}
  const out=path.resolve(output);if(inside(path.dirname(file),out))throw Error('请导出到受保护周记目录之外');
  await absent(out);let markdown=opened.markdown;
  const assetDir=out.replace(/\.md$/i,'')+'-assets';
  if(argv.includes('--with-assets')&&assets.length){
    await absent(assetDir);await mkdir(assetDir,{recursive:false});
    for(const {ref,bytes} of assets){
      const ext=path.extname(ref.name).replace(/[^.a-zA-Z0-9]/g,'');const name=ref.id+ext;
      await writeFile(path.join(assetDir,name),bytes,{flag:'wx'});
      const relative=path.basename(assetDir)+'/'+name;
      markdown=markdown.split(ref.link).join(ref.link.startsWith('![[')?'![['+relative+']]':ref.link.startsWith('[[')?'[['+relative+']]':(ref.link.startsWith('!')?'!':'')+'[]('+relative+')');
    }
  }
  await writeFile(out,markdown,{flag:'wx'});
  console.log('已导出明文；原密文未更改。'+(assets.length&&!argv.includes('--with-assets')?' 附件已验证但未导出，可添加 --with-assets。':''));
}catch(error){console.error(error.message);process.exitCode=1;}
