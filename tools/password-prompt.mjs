import {emitKeypressEvents} from 'node:readline';
export function passwordPrompt(label='口令（不回显）: '){
 if(!process.stdin.isTTY)throw Error('请在交互式终端运行；密码不接受命令行参数');
 return new Promise((resolve,reject)=>{
  let value='';process.stdout.write(label);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  const finish=()=>{process.stdin.off('keypress',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
  const handler=(s,key)=>{if(key?.ctrl&&key.name==='c'){finish();reject(Error('已取消'));}else if(key?.name==='return'){finish();resolve(value);value='';}else if(key?.name==='backspace')value=[...value].slice(0,-1).join('');else if(!key?.ctrl&&s)value+=s;};
  process.stdin.on('keypress',handler);
 });
}
