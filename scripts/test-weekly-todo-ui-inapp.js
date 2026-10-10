(async () => {
 let result;
 try {
  globalThis.__apexWeeklyTodoStage = 'loading';
  const fs = require('fs'), path = require('path');
  const project = path.dirname(globalThis.__apexTestOutputDir);
  const source = fs.readFileSync(path.join(project, 'test-build/weekly-todo-ui.cjs'), 'utf8');
  globalThis.__apexWeeklyTodoStage = 'evaluating';
  const testModule = { exports: {} };
  new Function('require', 'module', 'exports', source)(require, testModule, testModule.exports);
  globalThis.__apexWeeklyTodoStage = 'running';
  result = await testModule.exports.run(app);
 } catch (error) { result = { passed: false, stage: globalThis.__apexWeeklyTodoStage, error: error.message, stack: error.stack }; }
 globalThis.__apexWeeklyTodoStage = 'finished';
 await globalThis.__apexWriteTestReport('weekly-todo-ui.json', JSON.stringify(result, null, 2));
 return JSON.stringify(result);
})()
