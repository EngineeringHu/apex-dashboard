import { Modal, type App } from 'obsidian';

export function askPassword(app:App,title:string,confirm=false):Promise<string|null>{
  return new Promise(resolve=>{
    class PasswordModal extends Modal {
      private result:string|null=null;
      onOpen():void{
        this.titleEl.setText(title);
        this.contentEl.createEl('p',{text:confirm?'至少 3 个字符。设置后所有新周记共用此密码；密码不会明文保存。':'密码只用于本次操作，不写入配置。'});
        const input=this.contentEl.createEl('input',{type:'password',attr:{autocomplete:'off',placeholder:'口令'}});
        const repeat=confirm?this.contentEl.createEl('input',{type:'password',attr:{autocomplete:'off',placeholder:'再次输入'}}):null;
        const error=this.contentEl.createDiv();
        const submit=()=>{if(!input.value||(confirm&&([...input.value].length<3||input.value.length>1024||input.value!==repeat?.value))){error.setText(confirm?'密码至少 3 字符，且两次输入必须一致':'请输入密码');return;}this.result=input.value;input.value='';if(repeat)repeat.value='';this.close();};
        this.contentEl.createEl('button',{text:'确定',cls:'mod-cta'}).onclick=submit;
        this.contentEl.createEl('button',{text:'取消'}).onclick=()=>this.close();
        this.contentEl.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});input.focus();
      }
      onClose():void{this.contentEl.querySelectorAll('input').forEach(i=>i.value='');this.contentEl.empty();resolve(this.result);this.result=null;}
    }
    new PasswordModal(app).open();
  });
}
export function askText(app:App,title:string,value=''):Promise<string|null>{
  return new Promise(resolve=>{
    class TextModal extends Modal{
      result:string|null=null;
      onOpen():void{this.titleEl.setText(title);const input=this.contentEl.createEl('input',{type:'text'});input.value=value;
        const save=()=>{if(!input.value.trim())return;this.result=input.value.trim();this.close();};
        this.contentEl.createEl('button',{text:'确定'}).onclick=save;
        input.onkeydown=e=>{if(e.key==='Enter')save();};input.focus();}
      onClose():void{this.contentEl.empty();resolve(this.result);}
    }new TextModal(app).open();
  });
}
