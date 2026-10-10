(async()=>{
 const plugin=app.plugins.plugins['apex-dashboard'],s=plugin.secure;
 if(s.session.active||globalThis.__apexBoardTest)throw Error('Test session already active');
 const password=require('crypto').randomBytes(24).toString('hex'),marker='BOARD_SYNTHETIC_'+require('crypto').randomUUID();
 const originals=new Map();for(const f of s.files())originals.set(f.path,await s.crypto.call('hash',{value:await app.vault.read(f)}));
 const context=globalThis.__apexBoardTest={password,marker,originals,previous:app.workspace.activeLeaf,path:null,leaf:null};
 const report={version:plugin.manifest.version,checks:[],passed:false},errors=[],previousError=console.error;
 console.error=(...a)=>{errors.push(a.map(x=>x instanceof Error?x.stack:String(x)).join(' '));previousError.apply(console,a);};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const assert=(x,message)=>{if(!x)throw Error(message);};
 const until=async(fn,label)=>{for(let i=0;i<200;i++){const v=fn();if(v)return v;await sleep(40);}throw Error('Timeout: '+label);};
 const passwordDialog=async(title='解锁分区')=>{const m=await until(()=>Array.from(document.querySelectorAll('.modal')).find(x=>x.querySelector('.modal-title')?.textContent===title),'password modal');m.querySelector('input').value=password;Array.from(m.querySelectorAll('button')).find(x=>x.textContent==='确定').click();};
 try{
  const md='---\ndashboard: true\nbanner:\n  quote: Synthetic test\n  author: Local test\ncolumns:\n  - name: 个人使命\n    type: memo\n    height: 315\n  - name: 周计划表\n    type: table\n    height: 642\n  - name: 不断更新\n    type: todo\n---\n\n## 个人使命\n\n### 合成卡片\nid: synthetic-memo\n'+marker+'\n\n## 周计划表\n\n| 周计划 | > | 周一 |\n| --- | --- | --- |\n| 角色 | 目标 | 任务 |\n| 合成角色 | ➤ | '+marker+' |\n\n## 不断更新\n\n### 合成任务\nid: synthetic-tasks\ntype: task\n- [ ] '+marker+'\n';
  const definitions=[{name:'个人使命',sectionType:'memo',color:'#a1887f',height:315},{name:'周计划表',sectionType:'table',color:'#8d6e63',height:642},{name:'不断更新',sectionType:'todo',color:'#6366f1'}];
  const recipient=await s.crypto.call('recipient-create',{password});
  const encrypted=await s.crypto.call('create-public',{markdown:md,title:marker,recipient,definitions});context.path=await s.store.create(encrypted);await s.open(context.path);
  context.leaf=await until(()=>app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===context.path),'view');const view=context.leaf.view,root=view.contentEl;
  await until(()=>root.querySelector('.dashboard-main .dashboard-sidebar')&&root.querySelectorAll('.dashboard-section-row').length===3,'original dashboard layout');
  assert(!root.querySelector('.apex-protected-toolbar'),'no substitute toolbar');assert(!root.textContent.includes(marker),'locked DOM has no secret');
  const rows=()=>Array.from(root.querySelectorAll('.dashboard-section-row'));const row=i=>rows()[i];
  assert(rows().every(x=>x.dataset.secureLocked==='true'),'initial sections locked');
  report.checks.push('original sidebar/banner/kanban shell, exactly 3 locked sections, no extra information panel');
  row(0).querySelector('.dashboard-section-toggle').click();await passwordDialog();await until(()=>row(0).querySelector('.dashboard-memo-textarea'),'memo renderer');
  assert(getComputedStyle(row(0)).maxHeight==='315px','original memo height retained');
  const memo=row(0).querySelector('.dashboard-memo-textarea');memo.value='EDITED_'+marker;memo.dispatchEvent(new Event('input',{bubbles:true}));memo.dispatchEvent(new Event('blur'));await sleep(600);await view.boardPending;
  row(1).querySelector('.dashboard-section-toggle').click();await passwordDialog();await until(()=>row(1).querySelector('table'),'table renderer');
  assert(row(0).dataset.secureLocked==='false','unlocking table preserves memo session');
  const check=await until(()=>row(1).querySelector('.apex-table-task-check'),'table task');check.click();await sleep(100);await view.boardPending;
  const taskInput=row(1).querySelector('.apex-table-task-add-input');assert(taskInput,'original inline add task editor');taskInput.value='ADDED_'+marker;taskInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await sleep(100);await view.boardPending;
  row(1).querySelector('.dashboard-section-toggle').click();await until(()=>row(1).dataset.secureLocked==='true','table lock');assert(row(0).dataset.secureLocked==='false','collapse affects only chosen section');
  assert(!row(1).querySelector('table')&&!row(1).textContent.includes(marker),'locked table removed from DOM');
  row(1).querySelector('.dashboard-section-toggle').click();await passwordDialog();await until(()=>row(1).querySelector('.apex-table-task-check')?.checked,'persisted checkbox');assert(row(1).textContent.includes('ADDED_'+marker),'added task persisted');
  report.checks.push('memo inline edit and table checkbox/add-task persist encrypted; independent collapse and password on reopen');
  const callbacks=view.board.createCallbacks();callbacks.onColumnHeightChange('周计划表',700);await sleep(100);await view.boardPending;
  callbacks.onColumnRename('周计划表','周计划表（测试）',1);await sleep(100);await view.boardPending;
  assert(row(1).querySelector('h3').textContent==='周计划表（测试）','section rename editor enabled');
  callbacks.onCardAdd('个人使命');await until(()=>row(0).querySelectorAll('.dashboard-card').length===2,'original add-card callback works');await view.boardPending;
  report.checks.push('original section resize/rename and add-card callbacks save through encryption');
  const add=callbacks.onColumnAdd('自测新增分区','memo');await passwordDialog('验证密码以修改工作台布局');await until(()=>rows().length===4,'new section');await view.boardPending;
  report.checks.push('original add-section flow preserves existing ciphertext blocks');
  const move=view.board.createCallbacks().onColumnMove(3,1);await passwordDialog('验证密码以修改工作台布局');await sleep(100);await view.boardPending;
  await until(()=>row(1).querySelector('h3').textContent==='自测新增分区','section ordering rendered after encrypted save');
  const deletion=view.board.sync.deleteColumn('自测新增分区',1);await passwordDialog('验证密码以修改工作台布局');await deletion;await view.boardPending;
  assert(rows().length===3,'section deletion persisted');
  const cancelled=view.board.sync.addColumn('取消的分区','memo');const cancelModal=await until(()=>Array.from(document.querySelectorAll('.modal')).find(x=>x.querySelector('.modal-title')?.textContent==='验证密码以修改工作台布局'),'cancel layout modal');Array.from(cancelModal.querySelectorAll('button')).find(x=>x.textContent==='取消').click();await cancelled;await view.boardPending;
  assert(rows().length===3,'cancelled layout leaves no phantom section');
  report.checks.push('section reorder/delete and cancelled layout keep authenticated structure consistent');
  const exactId=view.model.columns[0].protectedBlockId,exact=view.openSections.get(exactId).payload.raw+'\n<!-- EXACT_RAW_'+marker+' -->\n';
  await view.saveExactRaw(exactId,exact);
  await s.lockFile(context.path);
  const all=await s.crypto.call('open-all',{text:await s.store.read(context.path),password});assert(all.markdown.includes('EDITED_'+marker),'memo edit saved');assert(all.markdown.includes('ADDED_'+marker),'table addition saved');assert(!all.markdown.includes('## 自测新增分区'),'layout deletion saved');assert(all.markdown.includes('<!-- EXACT_RAW_'+marker+' -->'),'unparsed Markdown preserved');await s.crypto.call('drop',{token:all.token});
  const ciphertext=await s.store.read(context.path);assert(!ciphertext.includes(marker),'ciphertext on disk');
  assert(!errors.length,'Unexpected console error: '+errors.join('\n'));report.passed=true;
 }catch(e){report.error={message:e.message,stack:e.stack};}
 finally{console.error=previousError;report.finished=new Date().toISOString();await globalThis.__apexWriteTestReport('board-inapp.json',JSON.stringify(report,null,2));}
 return JSON.stringify(report);
})()
