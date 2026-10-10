(async()=>{
 const ctx=globalThis.__apexBoardTest;if(!ctx)throw Error('Run the synthetic board test first');
 const s=app.plugins.plugins['apex-dashboard'].secure,report={passed:false,checks:[]};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));const until=async(f,label)=>{for(let i=0;i<160;i++){const v=f();if(v)return v;await sleep(40);}throw Error('Timeout: '+label);};
 const assert=(value,message)=>{if(!value)throw Error(message);};
 const submit=async(title)=>{const m=await until(()=>Array.from(document.querySelectorAll('.modal')).find(x=>x.querySelector('.modal-title')?.textContent===title),'modal');m.querySelector('input').value=ctx.password;Array.from(m.querySelectorAll('button')).find(b=>b.textContent==='确定').click();};
 const unlock=async(v)=>{v.contentEl.querySelector('.dashboard-section-toggle').click();await submit('解锁分区');await until(()=>v.openSections.size===1,'unlocked');};
 let second;
 try{
  const first=ctx.leaf.view;await unlock(first);await s.open(ctx.path);
  second=app.workspace.getLeavesOfType('apex-protected-view').find(l=>l!==ctx.leaf&&l.view.file?.path===ctx.path);assert(second,'second tab');await until(()=>second.view.contentEl.querySelector('.dashboard-section-toggle'),'second board');await unlock(second.view);
  first.contentEl.querySelector('.dashboard-section-toggle').click();await until(()=>first.openSections.size===0&&second.view.openSections.size===0,'both locked');report.checks.push('collapse locks same section in both tabs and clears plaintext');
  await unlock(first);await unlock(second.view);await second.detach();second=null;await until(()=>first.openSections.size===0,'closing tab locks other copy');report.checks.push('closing a tab locks remaining copies');
  const editing=first.editWhole();await submit('打开整篇 Markdown');await editing;assert(first.whole,'whole editor active');
  first.whole.editor.value=first.whole.editor.value.replace('EDITED_'+ctx.marker,'WHOLE_'+ctx.marker);first.whole.editor.dispatchEvent(new Event('input',{bubbles:true}));await s.lockFile(ctx.path);
  assert(!first.whole&&first.contentEl.querySelectorAll('.dashboard-section-row').length===3,'whole editor returns to original shell');
  await ctx.leaf.detach();await s.open(ctx.path);ctx.leaf=app.workspace.getLeavesOfType('apex-protected-view').find(l=>l.view.file?.path===ctx.path);await until(()=>ctx.leaf.view.contentEl.querySelector('.dashboard-section-toggle'),'reopened shell');await unlock(ctx.leaf.view);
  assert(ctx.leaf.view.contentEl.textContent.includes('WHOLE_'+ctx.marker),'whole edits persisted after reopen');
  assert(ctx.leaf.view.contentEl.textContent.includes('周计划表（测试）'),'saved section labels recovered after authentication');
  await s.lockFile(ctx.path);report.checks.push('whole Markdown edit/save/close/reopen preserves content and section layout');report.passed=true;
 }catch(e){report.error={message:e.message,stack:e.stack};}
 finally{if(second)await second.detach();report.finished=new Date().toISOString();await globalThis.__apexWriteTestReport('board-lifecycle.json',JSON.stringify(report,null,2));}
 return JSON.stringify(report);
})()
