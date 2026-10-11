(async () => {
 const fs = require('fs'), path = require('path'), crypto = require('crypto');
 const project = path.dirname(globalThis.__apexTestOutputDir);
 const decode = file => {
  const bytes = fs.readFileSync(file);
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  if(text.includes('%TSD-Header')) throw Error('Wrapped file: '+file);
  return text;
 };
 const load = name => {
  const code=decode(path.join(project,'test-build',name+'.js'));
  const mod={exports:{}};
  new Function('require','module','exports',code)(require,mod,mod.exports);
  return mod.exports;
 };
 const files=app.vault.getFiles().filter(file=>file.extension==='md'||file.extension==='apexenc');
 const hash = async file => crypto.createHash('sha256').update(Buffer.from(await app.vault.readBinary(file))).digest('hex');
 const before=new Map();
 for(const file of files) before.set(file.path,await hash(file));
 const css=decode(path.join(project,'styles.css'));
 const style=document.createElement('style');
 style.textContent='@scope (.apex-table-test) {'+css+'\n}';
 document.head.appendChild(style);
 let result;
 try {
  if(style.sheet?.cssRules[0]?.constructor.name!=='CSSScopeRule') throw Error('Scoped preview CSS not supported');
  result=await load('verify-table-layout-ui').run(app);
  if(result.passed) result.weeklyTodo=await load('verify-weekly-todo-ui').run(app);
 } catch(error) { result={passed:false,error:error.message,stack:error.stack}; }
 finally {style.remove();}
 const changed=[];
 for(const file of files) if(before.get(file.path)!==await hash(file)) changed.push(file.path);
 result.unchangedNotes=files.length-changed.length;
 result.changedNotes=changed;
 if(changed.length) result.passed=false;
 await globalThis.__apexWriteTestReport('table-layout-ui.json',JSON.stringify(result,null,2));
 return JSON.stringify(result);
})()
