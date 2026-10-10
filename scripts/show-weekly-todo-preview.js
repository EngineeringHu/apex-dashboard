(() => {
 for(const modal of document.querySelectorAll('.modal-container')){
  if(modal.querySelector('.modal-title')?.textContent==='新版周计划 · 待办卡片预览') modal.querySelector('.modal-close-button, .modal-header-button')?.click();
 }
 const fs=require('fs'),path=require('path');
 const code=fs.readFileSync(path.join(path.dirname(globalThis.__apexTestOutputDir),'test-build/weekly-todo-preview.cjs'),'utf8');
 const module={exports:{}};
 new Function('require','module','exports',code)(require,module,module.exports);
 return JSON.stringify(module.exports.showPreview(app));
})()
