(async () => {
 const fs=require('fs'), path=require('path'), crypto=require('crypto');
 const window=require('@electron/remote').getCurrentWindow();
 if(window.isMinimized())window.restore();
 for(const host of document.querySelectorAll('.apex-task-style-test'))if(!host.childElementCount)host.remove();
 if(document.querySelector('.apex-task-style-test'))return JSON.stringify({running:true,message:'Existing synthetic UI test resumed; no second test started'});
 const project=path.dirname(globalThis.__apexTestOutputDir);
 const source=fs.readFileSync(path.join(project,'test-build/task-presentation-ui.cjs'),'utf8');
 const files=app.vault.getFiles().filter(f=>['md','apexenc','apexdaily'].includes(f.extension));
 const hash=async f=>crypto.createHash('sha256').update(Buffer.from(await app.vault.readBinary(f))).digest('hex');
 const before=new Map();for(const file of files)before.set(file.path,await hash(file));
 const style=document.createElement('style');
 style.textContent='@scope (.apex-task-style-test, .apex-task-style-modal) {'+fs.readFileSync(path.join(project,'styles.css'),'utf8')+'\n}';
 document.head.appendChild(style);
 // Use an isolated in-memory plugin loader to get Obsidian's actual API exports.
 // It never installs a plugin, changes enabled plugins, or writes a vault file.
 const id='apex-task-style-synthetic-test',dir='__apex_synthetic_task_style__';
 const script=source+'\nconst __apexTestRun=module.exports.run; module.exports=class extends require("obsidian").Plugin { async onload(){this.result=await __apexTestRun(this.app);} async loadCSS(){} };';
 const testApp=Object.create(app),vault=Object.create(app.vault);
 vault.read=async file=>typeof file==='string'&&file===dir+'/main.js'?script:app.vault.read(file);
 const adapter=Object.create(app.vault.adapter);
 adapter.read=async file=>file===dir+'/main.js'?script:app.vault.adapter.read(file);
 Object.defineProperty(vault,'adapter',{value:adapter,configurable:true,writable:true});
 Object.defineProperty(testApp,'vault',{value:vault});
 const manager=Object.create(app.plugins);
 manager.app=testApp;manager.plugins={};manager.manifests={[id]:{id,name:'Synthetic task style test',version:'0',minAppVersion:'1.0.0',dir}};
 manager.isEnabled=()=>true;
 let result;
 try {
  if(style.sheet?.cssRules[0]?.constructor.name!=='CSSScopeRule')throw Error('Scoped CSS unavailable');
  const plugin=await manager.loadPlugin(id);
  result=plugin?.result;
  if(!result)throw Error('Synthetic UI harness did not return a result');
 } catch(error){result={passed:false,error:error.message,stack:error.stack};}
 finally {await manager.unloadPlugin(id);style.remove();}
 const changed=[];for(const file of files)if(before.get(file.path)!==await hash(file))changed.push(file.path);
 result.unchangedNotes=files.length-changed.length;result.changedNotes=changed;
 if(changed.length)result.passed=false;
 await globalThis.__apexWriteTestReport('task-presentation-ui.json',JSON.stringify(result,null,2));
 return JSON.stringify(result);
})()
