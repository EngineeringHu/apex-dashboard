import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
if(existsSync('.apex-protected-session.json')){console.error('临时解密会话尚未结束，请先在 Obsidian 中结束并锁定。');process.exit(1);}
if(existsSync('.apex-weekly-rotation.json')){console.error('统一密码更新尚未完成，请先在 Obsidian 中恢复密码更新。');process.exit(1);}
if(existsSync('.apex-weekly-mode-change.json')){console.error('周记加密开关切换尚未完成，请先在 Obsidian 设置中继续切换。');process.exit(1);}
const check=spawnSync('git',['diff','--cached','--quiet','--','周记/_临时解密','.apex-protected-session.json','.apex-weekly-rotation.json','.apex-weekly-staging','.apex-weekly-mode-change.json','.apex-weekly-mode-staging'],{stdio:'ignore',windowsHide:true});
if(check.status!==0){console.error('检测到临时明文或会话日志待提交，提交已阻止。');process.exit(1);}
