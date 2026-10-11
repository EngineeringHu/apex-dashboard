#!/usr/bin/env node
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { parseEnvelope, resolveRoot, openAll } from '../src/secure/format.mjs';

function promptPassword() {
  if (!process.stdin.isTTY) throw Error('请在交互式终端运行，密码不能放在命令行参数中');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('统一密码（不回显）: ');
    emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
    const finish = () => { process.stdin.off('keypress', handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const handler = (text, key) => {
      if (key?.ctrl && key.name === 'c') { finish(); reject(Error('已取消')); }
      else if (key?.name === 'return') { finish(); resolve(value); value = ''; }
      else if (key?.name === 'backspace') value = value.slice(0, -1);
      else if (!key?.ctrl && text) value += text;
    };
    process.stdin.on('keypress', handler);
  });
}
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }

try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) { console.log('用法: node tools/decrypt-daily.mjs <文件.apexdaily> --verify\n或: node tools/decrypt-daily.mjs <文件.apexdaily> --output <日记目录外文件.md>'); process.exit(0); }
  const file = path.resolve(args[0]);
  if (!file.endsWith('.apexdaily')) throw Error('请输入 .apexdaily 日记密文');
  const outputIndex = args.indexOf('--output'), output = outputIndex >= 0 ? args[outputIndex + 1] : null;
  if (!args.includes('--verify') && !output) throw Error('请提供 --verify 或 --output');
  const envelope = parseEnvelope(await readFile(file, 'utf8'));
  let password = await promptPassword();
  const root = await resolveRoot(password, envelope); password = '';
  const opened = await openAll(envelope, root);
  const doc = opened.payloads?.[0]?.document;
  if (opened.payloads.length !== 1 || doc?.kind !== 'daily' || doc.version !== 1 || typeof doc.path !== 'string' || !doc.path.startsWith('日记/') || !doc.path.endsWith('.md') || doc.path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) throw Error('日记密文元数据无效');
  const relativeCipher = doc.path.slice(0, -3) + '.apexdaily';
  if (!file.endsWith(path.sep + relativeCipher.split('/').join(path.sep))) throw Error('日记密文位置与认证的原路径不一致');
  const diaryRoot = file.slice(0, -relativeCipher.length);
  const diaryFolder = path.join(diaryRoot, '日记');
  if (args.includes('--verify')) { console.log(`验证成功：${doc.path}，正文及原路径认证通过。`); process.exit(0); }
  const target = path.resolve(output);
  if (inside(diaryFolder, target)) throw Error('请先导出到日记目录之外，避免覆盖现有日记');
  try { await access(target); throw Error('拒绝覆盖已有输出：' + target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(target, opened.markdown, { flag: 'wx' });
  console.log(`已导出 ${doc.path}；原密文未更改。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
