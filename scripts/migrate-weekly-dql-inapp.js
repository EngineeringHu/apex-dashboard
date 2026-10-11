(async()=>{
 const fs=require('fs'),path=require('path');
 const code=fs.readFileSync(path.join(globalThis.__apexTestOutputDir,'../test-build/weekly-dql-migration.cjs'),'utf8');
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const result=await module.exports.run(app,app.plugins.plugins['apex-dashboard']);
 await globalThis.__apexWriteTestReport('weekly-dql-migration.json',JSON.stringify(result,null,2));
 return JSON.stringify(result);
})()
