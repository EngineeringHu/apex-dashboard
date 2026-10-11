(async () => {
 const fs=require('fs'), path=require('path');
 const window=require('@electron/remote').getCurrentWindow();
 if(window.isMinimized()) window.restore();
 window.show(); window.focus();
 const project=path.dirname(globalThis.__apexTestOutputDir);
 const decode=file=>{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));
  if(text.includes('%TSD-Header'))throw Error('Wrapped preview source');
  return text;
 };
 for(const modal of document.querySelectorAll('.modal-container')) {
  if(modal.querySelector('.modal-title')?.textContent==='周计划表 · 自适应布局预览') modal.querySelector('.modal-close-button')?.click();
 }
 const module={exports:{}};
 new Function('require','module','exports',decode(path.join(project,'test-build/preview-table-layout.js')))(require,module,module.exports);
 const result=module.exports.showPreview(app,decode(path.join(project,'styles.css')));
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 try {
  const remote=require('@electron/remote');
  const image=await remote.getCurrentWindow().webContents.capturePage();
  fs.writeFileSync(path.join(globalThis.__apexTestOutputDir,'table-layout-preview.png'),image.toPNG());
  result.screenshot='table-layout-preview.png';
 } catch(error) {result.screenshotUnavailable=error.message;}
 return JSON.stringify(result);
})()
