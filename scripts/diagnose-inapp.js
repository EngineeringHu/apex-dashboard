(async()=>{
  const plugin=app.plugins.plugins['apex-dashboard'];
  const result={vault:app.vault.getName(),appVersion:require('obsidian').apiVersion,versions:process.versions,pluginVersion:plugin?.manifest.version,pluginDir:plugin?.manifest.dir,notices:Array.from(document.querySelectorAll('.notice')).map(x=>x.textContent),protectedCount:plugin?.secure.files().length};
  try {await plugin.secure.crypto.call('domain');result.worker='ok';}catch(e){result.worker={message:e.message,stack:e.stack};}
  return JSON.stringify(result);
})()
