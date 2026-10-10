(async()=>{
 const c=globalThis.__apexModeTest;if(!c)throw Error('No fixture');const p=app.plugins.plugins['apex-dashboard'],s=p.secure,a=app.vault.adapter;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),assert=(x,m)=>{if(!x)throw Error(m);};
 const until=async(fn,label)=>{for(let i=0;i<400;i++){const value=fn();if(value)return value;await sleep(30);}throw Error('Timeout '+label);};
 if(s.mode.pending){let failure;const resume=s.mode.resume().catch(e=>failure=e);
 const modal=await until(()=>Array.from(document.querySelectorAll('.modal')).find(m=>m.querySelector('.modal-title')?.textContent==='继续关闭加密：验证周记密码'),'resume password');modal.querySelector('input').value=c.password;Array.from(modal.querySelectorAll('button')).find(b=>b.textContent==='确定').click();await resume;if(failure)throw failure;}
 assert(!s.mode.enabled&&!s.mode.pending&&!await a.exists('.apex-weekly-mode-change.json'),'resume finished normal mode');
 const normal=app.vault.getMarkdownFiles().filter(f=>f.basename.startsWith(c.prefix));assert(normal.length===4,'all normal notes present');
 const table=normal.find(f=>f.basename.endsWith('-0-2'));assert(table,'converted table note');await p.switchWorkspace(table.path.replace(/\.md$/,''));const leaf=app.workspace.getLeaf('tab');await leaf.setViewState({type:'apex-dashboard-view',active:true});
 const checkbox=await until(()=>leaf.view.contentEl.querySelector('.apex-table-task-check'),'ordinary original table checkbox');const before=checkbox.checked;checkbox.checked=!before;checkbox.dispatchEvent(new Event('change',{bubbles:true}));await sleep(100);await leaf.view.flushBeforeEncryption();const raw=await app.vault.read(table);assert(raw.includes(before?'- [ ]':'- [x]'),'ordinary workbench edit persisted');
 const dv=app.plugins.plugins.dataview;if(dv)await until(()=>normal.every(f=>dv.index.pages.has(f.path)),'restored normal Dataview pages');
 for(const [path,hash]of c.originals)assert(await s.crypto.call('hash',{value:await a.read(path)})===hash,'real note unchanged');
 c.checks.push('plugin reload detects interrupted conversion; resume authenticates and completes; ordinary Apex table checkbox edits .md and Dataview indexes it');
 const report={version:p.manifest.version,passed:true,checks:c.checks,finished:new Date().toISOString()};await globalThis.__apexWriteTestReport('mode-inapp.json',JSON.stringify(report,null,2));return JSON.stringify(report);
})()
