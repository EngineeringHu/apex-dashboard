(async()=>{
  const secure=app.plugins.plugins['apex-dashboard'].secure;
  const j=secure.session.journal;
  if(!j)return 'No pending session';
  if(!j.entries.length||!j.entries.every(e=>e.sealed&&e.work.includes('/APEX_SYNTHETIC_')))throw Error('Not a sealed synthetic session');
  await secure.session.finish();
  return JSON.stringify({active:secure.session.active});
})()
