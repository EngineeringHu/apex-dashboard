import { Notice, TFile } from 'obsidian';
import type { SecureController } from './controller';
import { askPassword } from './dialogs';
import { envelope, freshId, PROTECTED_ROOT } from './runtime';

export const KEYRING='.apex-weekly-keyring.json';
const JOURNAL='.apex-weekly-rotation.json',STAGING='.apex-weekly-staging';
type Entry={path:string;before:string;after:string;index:number};
type Rotation={version:1;id:string;previous:string|null;next:string;entries:Entry[]};

/** Only a public key and a password-encrypted private key are synchronized.
 * Rotation stages authenticated ciphertext per file; interrupted commits roll
 * forward after restart, without saving a password or any plaintext content. */
export class WeeklyCredentials {
  busy=false;
  creating=0;
  constructor(private controller:SecureController){}
  private get app(){return this.controller.plugin.app;}
  private get adapter(){return this.app.vault.adapter;}
  private async readConfig():Promise<string|null>{return await this.adapter.exists(KEYRING)?this.adapter.read(KEYRING):null;}
  async configured():Promise<boolean>{return (await this.readConfig())!==null;}
  async assertReady():Promise<void>{await this.controller.mode?.assertReady();if(this.controller.dailyMode?.busy||this.controller.dailyMode?.pending)throw Error('日记加密切换尚未完成，请先在设置中继续切换');if(this.busy||await this.adapter.exists(JOURNAL)||this.busy)throw Error('统一密码正在更新或有待恢复操作，请先执行“恢复统一密码更新”');}
  async get():Promise<any|null>{
    const text=await this.readConfig();if(text===null)return null;
    const recipient=JSON.parse(text);await this.controller.crypto.call('recipient-validate',{recipient});return recipient;
  }
  async setup():Promise<void>{
    await this.assertReady();if(this.busy||this.creating)throw Error('周记操作进行中，请稍后设置密码');if(this.controller.session.active)throw Error('请先结束临时明文模式');
    if(this.controller.dailyMode.busy||this.controller.dailyMode.pending||this.controller.dailyMode.encryptedFiles().length)throw Error('请先解密日记，再设置或更改统一密码');
    this.busy=true;const c=this.controller;let committed=false;
    try{
      const previous=await this.readConfig(),existing=c.files();
      let oldPassword='';
      if(previous||existing.length){
        const value=await askPassword(this.app,previous?'验证当前统一密码':'验证已有周记密码');if(value===null)return;oldPassword=value;
        if(previous)await c.crypto.call('recipient-check',{recipient:JSON.parse(previous),password:oldPassword});
        for(const file of existing)await c.crypto.call('check-password',{text:await c.store.read(file.path),password:oldPassword});
      }
      const password=await askPassword(this.app,previous?'设置新的统一周记密码':'设置统一周记密码',true);if(password===null)return;
      await c.lockAll();c.status('正在设置统一密码…');
      const recipient=await c.crypto.call('recipient-create',{password});
      const journal:Rotation={version:1,id:freshId(),previous,next:JSON.stringify(recipient)+'\n',entries:[]};
      const directory=STAGING+'/'+journal.id;
      if(!await this.adapter.exists(STAGING))await this.adapter.mkdir(STAGING);
      await this.adapter.mkdir(directory);
      // Sequential work bounds memory and leaves rendering on the main thread free.
      for(const [index,file] of c.files().entries()){
        const text=await c.store.read(file.path),next=await c.crypto.call<string>('migrate-recipient',{text,password:oldPassword,recipient,newPassword:password});
        const entry={path:file.path,index,before:await c.crypto.call<string>('hash',{value:text}),after:await c.crypto.call<string>('hash',{value:next})};
        await this.adapter.write(directory+'/'+index+'.apexenc',next);
        if(await c.crypto.call('hash',{value:await this.adapter.read(directory+'/'+index+'.apexenc')})!==entry.after)throw Error('迁移暂存写入校验失败，原文件未更改');
        journal.entries.push(entry);c.status('正在验证统一密码：'+(index+1));
      }
      for(const entry of journal.entries)if(await c.crypto.call('hash',{value:await c.store.read(entry.path)})!==entry.before)throw Error('周记被外部修改，未开始替换，请重新设置');
      if(await this.readConfig()!==previous)throw Error('统一密码配置被外部修改，请重试');
      await this.adapter.write(JOURNAL,JSON.stringify(journal));
      await this.commit(JSON.parse(await this.adapter.read(JOURNAL)));committed=true;
      await this.renameLegacy(password);
      new Notice('统一密码已设置。新建周记无需输入密码，展开分区仍需输入密码。',10000);
    }finally{this.busy=false;if(committed)c.status('统一密码已设置 · 周记已锁定');}
  }
  private async commit(j:Rotation):Promise<void>{
    if(j.version!==1||!/^[-a-f0-9]{36}$/.test(j.id)||!Array.isArray(j.entries)||typeof j.next!=='string'||!(j.previous===null||typeof j.previous==='string'))throw Error('密码更新日志无效，已停止恢复');
    await this.controller.crypto.call('recipient-validate',{recipient:JSON.parse(j.next)});
    const seen=new Set<string>();
    for(const [index,e] of j.entries.entries()){
      if(e.index!==index||!e.path.startsWith(PROTECTED_ROOT+'/')||e.path.slice(PROTECTED_ROOT.length+1).includes('/')||e.path.includes('\\')||!e.path.endsWith('.apexenc')||seen.has(e.path))throw Error('密码更新路径无效');
      seen.add(e.path);
      const next=await this.adapter.read(STAGING+'/'+j.id+'/'+e.index+'.apexenc');envelope(next);
      if(await this.controller.crypto.call('hash',{value:next})!==e.after)throw Error('迁移暂存文件已改变，保留现场待恢复');
      const current=await this.controller.store.read(e.path),hash=await this.controller.crypto.call('hash',{value:current});
      if(hash===e.after)continue;
      if(hash!==e.before)throw Error('周记存在外部修改，密码更新已暂停：'+e.path);
      await this.controller.store.replace(e.path,current,next);
    }
    const config=await this.readConfig();if(config!==j.previous&&config!==j.next)throw Error('统一密码配置有外部修改，已暂停恢复');
    if(config!==j.next)await this.adapter.write(KEYRING,j.next);
    if(await this.adapter.read(KEYRING)!==j.next)throw Error('统一密码配置写入失败');
    await this.adapter.remove(JOURNAL);
    for(const e of j.entries)try{await this.adapter.remove(STAGING+'/'+j.id+'/'+e.index+'.apexenc');}catch{/* Ciphertext-only orphan; no plaintext or password. */}
  }
  async recover():Promise<void>{
    if(!await this.adapter.exists(JOURNAL))return;
    if(this.busy||this.creating||this.controller.session.active)throw Error('请先结束当前操作再恢复统一密码更新');
    this.busy=true;
    try{await this.controller.lockAll();await this.commit(JSON.parse(await this.adapter.read(JOURNAL)));new Notice('中断的统一密码更新已完成，请使用新密码解锁。');}
    finally{this.busy=false;}
  }
  async restoreNames():Promise<void>{
    await this.assertReady();if(this.busy||this.creating)throw Error('周记操作进行中，请稍后恢复文件名');if(this.controller.session.active)throw Error('请先结束临时明文模式');
    this.busy=true;try{const password=await askPassword(this.app,'验证密码以恢复周记文件名');if(password===null)return;await this.controller.lockAll();const count=await this.renameLegacy(password);new Notice('已恢复 '+count+' 个周记文件名');}finally{this.busy=false;}
  }
  private async renameLegacy(password:string):Promise<number>{
    const names:Array<{file:TFile;title:string}>=[];
    for(const file of this.controller.files())if(/^[a-f0-9-]{36}$/.test(file.basename)){
      const title=await this.controller.crypto.call<string>('read-title',{text:await this.controller.store.read(file.path),password});if(title)names.push({file,title});
    }
    for(const {file,title} of names){const path=await this.controller.store.namedPath(title,file.path);if(path!==file.path)await this.app.fileManager.renameFile(file,path);}
    return names.length;
  }
}
