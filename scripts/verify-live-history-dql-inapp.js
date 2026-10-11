(async()=>{
 const fs=require('fs'),path=require('path');
 const report=JSON.parse(fs.readFileSync(path.join(globalThis.__apexTestOutputDir,'weekly-dql-migration.json'),'utf8'));
 const code=fs.readFileSync(path.join(globalThis.__apexTestOutputDir,'../test-build/verify-live-history-dql.cjs'),'utf8');
 const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
 const result=await module.exports.run(app,app.plugins.plugins['apex-dashboard'],report.backup);
 await globalThis.__apexWriteTestReport('weekly-dql-live.json',JSON.stringify(result,null,2));
 return JSON.stringify(result);
})()
