(async () => {
 const plugin=app.plugins.plugins['apex-dashboard'];
 if(plugin.secure.session.active) throw Error('Active plaintext edit session');
 if(document.activeElement instanceof HTMLElement) document.activeElement.blur();
 const {MarkdownView}=require('obsidian');
 for(const leaf of app.workspace.getLeavesOfType('markdown')) if(leaf.view instanceof MarkdownView) await leaf.view.save();
 const leaves=[]; app.workspace.iterateAllLeaves(leaf=>leaves.push(leaf));
 for(const leaf of leaves) await leaf.view.sync?.flushPending?.();
 await plugin.secure.lockAll();
 const crypto=require('crypto');
 const hashes={};
 for(const f of app.vault.getFiles()) {
  if(f.extension==='md'||f.extension==='apexenc') hashes[f.path]=crypto.createHash('sha256').update(Buffer.from(await app.vault.readBinary(f))).digest('hex');
 }
 globalThis.__apexWeeklyDeploy={hashes,previousLeaf:app.workspace.activeLeaf};
 return JSON.stringify({ready:true,checkedFiles:Object.keys(hashes).length});
})()
