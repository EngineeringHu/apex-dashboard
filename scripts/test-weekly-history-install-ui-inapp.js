(async()=>{
 const fs=require('fs'),path=require('path');
 const code=fs.readFileSync(path.join(globalThis.__apexTestOutputDir,'../test-build/weekly-history-install-ui.cjs'),'utf8');
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const result=await module.exports.run(app, app.plugins.plugins['apex-dashboard'].secure.crypto);
 await globalThis.__apexWriteTestReport('weekly-history-install-ui.json',JSON.stringify(result,null,2));
 return JSON.stringify(result);
})()
