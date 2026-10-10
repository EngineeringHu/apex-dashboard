#!/usr/bin/env node
import {readFile,stat,access,readdir,realpath,mkdir,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from '../src/parser.ts';
import {checkRecipient,createRecipient,createPublic,stringify,encryptAsset,decryptAsset,MAX_ASSET_BYTES} from '../src/secure/format.mjs';
import {passwordPrompt} from './password-prompt.mjs';
async function exists(file){try{await access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function inside(root,file){const r=path.relative(root,file);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));}
export async function findKeyring(input){
 let dir=path.dirname(path.resolve(input));
 while(true){const p=path.join(dir,'.apex-weekly-keyring.json');if(await exists(p))return p;const parent=path.dirname(dir);if(parent===dir)return null;dir=parent;}
}
async function attachmentRoot(input){
 let dir=path.dirname(input);
 while(true){if(await exists(path.join(dir,'.obsidian'))||await exists(path.join(dir,'.apex-weekly-keyring.json')))return dir;const parent=path.dirname(dir);if(parent===dir)return path.dirname(input);dir=parent;}
}
const mimeFor=name=>({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.bmp':'image/bmp','.pdf':'application/pdf'}[path.extname(name).toLowerCase()]||'application/octet-stream');
export async function encryptWeekly({input,output,keyring,recipient}){
 input=path.resolve(input);output=path.resolve(output);
 if(path.extname(input).toLowerCase()!=='.md'||path.extname(output).toLowerCase()!=='.apexenc')throw Error('输入必须是 .md，输出必须是 .apexenc');
 if(await exists(output))throw Error('拒绝覆盖已有输出：'+output);
 const outputDir=await realpath(path.dirname(output));
 if(keyring){
  keyring=path.resolve(keyring);
  for(const pending of ['.apex-weekly-rotation.json','.apex-weekly-mode-change.json','.apex-protected-session.json'])
   if(await exists(path.join(path.dirname(keyring),pending)))throw Error('笔记库有未完成的加密操作，请先在 Obsidian 中完成恢复');
  recipient=JSON.parse(await readFile(keyring,'utf8'));
 }
 checkRecipient(recipient);
 if((await stat(input)).size>4*1024*1024)throw Error('Markdown 超过 4 MiB 限制');
 const markdown=await readFile(input,'utf8');
 const definitions=parse(markdown).columns.map(({cards,tableContent,...definition})=>definition);
 const scope=await realpath(await attachmentRoot(input)),sourceDir=path.dirname(input),refs=[],seenLinks=new Set();
 let basenameIndex=null;
 async function resolveLocal(link){
  const candidates=[path.resolve(sourceDir,link),path.resolve(scope,link)];
  for(const candidate of [...new Set(candidates)]){
   if(!inside(scope,candidate))continue;
   if(await exists(candidate)){const actual=await realpath(candidate);if(!inside(scope,actual))throw Error('附件链接指向范围外文件：'+link);if((await stat(actual)).isFile())return actual;}
  }
  if(link.includes('/')||link.includes('\\'))return null;
  if(!basenameIndex){
   basenameIndex=new Map();let scanned=0;
   async function walk(dir){
    for(const entry of await readdir(dir,{withFileTypes:true})){
     if(++scanned>50000)throw Error('附件检索范围过大，请改用相对于笔记的附件路径');
     if(entry.name.startsWith('.')||entry.name==='node_modules'||entry.isSymbolicLink())continue;
     const file=path.join(dir,entry.name);
     if(entry.isDirectory())await walk(file);
     else if(entry.isFile()){const key=entry.name.toLowerCase();basenameIndex.set(key,[...(basenameIndex.get(key)||[]),file]);}
    }
   }
   await walk(scope);
  }
  const matches=basenameIndex.get(link.toLowerCase())||[];
  if(matches.length>1)throw Error('存在同名附件，请改为明确的相对路径：'+link);
  return matches[0]||null;
 }
 const owned=[],assetDir=path.join(outputDir,'_assets');let assetCount=0;
 async function writeNew(file,data){const h=await open(file,'wx');owned.push(file);try{await h.writeFile(data,'utf8');}finally{await h.close();}}
 try{
 const links=[...markdown.matchAll(/!?\[\[([^\]]+)\]\]|!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)/g)];
 for(const match of links){
  if(seenLinks.has(match[0]))continue;seenLinks.add(match[0]);
  let link=match[1]??match[2]??'';
  link=link.startsWith('<')?link.slice(1,link.indexOf('>')):link.replace(/\s+["'][^"']*["']\s*$/,'');
  link=decodeURIComponent(link.split('|')[0].split('#')[0].trim());
  if(!link)continue;
  if(/^[a-z][a-z0-9+.-]*:/i.test(link)||link.startsWith('//')){if(match[0].startsWith('!'))throw Error('请先下载远程图片，再加密：'+link);continue;}
  if(!path.extname(link)){if(match[0].startsWith('!'))throw Error('嵌入笔记或无扩展名附件暂不支持：'+link);continue;}
  const file=await resolveLocal(link);
  if(!file){if(match[0].startsWith('!')||path.extname(link).toLowerCase()!=='.md')throw Error('未找到附件：'+link);continue;}
  if(path.extname(file).toLowerCase()==='.md'){if(match[0].startsWith('!'))throw Error('请将嵌入笔记内容合并后再加密：'+link);continue;}
  if((await stat(file)).size>MAX_ASSET_BYTES)throw Error('附件超过 32 MiB：'+link);
  const bytes=await readFile(file),{asset,key}=await encryptAsset(bytes);
  const ref={id:asset.id,key,name:path.basename(file),link:match[0],mime:mimeFor(file)};
  if(!Buffer.from(await decryptAsset(asset,ref)).equals(bytes))throw Error('附件加密校验失败');
  if(assetCount===0){await mkdir(assetDir,{recursive:true});if(await realpath(assetDir)!==assetDir)throw Error('附件目录不能是符号链接或目录联接');}
  await writeNew(path.join(assetDir,asset.id+'.apexasset'),JSON.stringify(asset));
  refs.push(ref);assetCount++;
 }
 const envelope=await createPublic(markdown,path.basename(output,'.apexenc'),recipient,definitions,refs);
 const text=stringify(envelope);
  await writeNew(output,text);
  if(await readFile(output,'utf8')!==text)throw Error('密文写入校验失败');
 }catch(e){for(const file of owned.reverse())await unlink(file).catch(()=>{});throw e;}
 return {output,assets:assetCount};
}
async function main(){
 const args=process.argv.slice(2);
 if(!args[0]||args.includes('--help')){console.log('用法：node encrypt-weekly.mjs <文件.md> --output <文件.apexenc> [--keyring <.apex-weekly-keyring.json>]');return;}
 const value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
 const input=args[0],output=value('--output');if(!output)throw Error('请指定 --output');
 const keyring=value('--keyring')||await findKeyring(input);
 let recipient;
 if(keyring)console.log('使用已有统一周记密码配置，无需再次输入密码。');
 else{
  console.log('未找到统一密码配置，请为此文件设置密码（至少 3 个字符）。');
  let a=await passwordPrompt('设置密码（不回显）: '),b=await passwordPrompt('再次输入（不回显）: ');
  if(a!==b)throw Error('两次密码不一致');recipient=await createRecipient(a);a='';b='';
 }
 const result=await encryptWeekly({input,output,keyring,recipient});
 console.log('已生成加密副本：'+result.output+'\n已加密附件：'+result.assets+' 个。\n原 .md 和原附件仍为明文，未删除；如需整个周记文件夹加密，请使用 Obsidian 设置中的加密开关。');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});
