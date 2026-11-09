// Teste com fetch simulado: cria pastas Ano/Mês/Id - Nome uma única vez e carrega o ficheiro
process.env.GOOGLE_CLIENT_ID='c'; process.env.GOOGLE_CLIENT_SECRET='s'; process.env.GOOGLE_REFRESH_TOKEN='r';
const assert=require('assert'); const calls=[]; const folders=new Map(); let n=0;
global.fetch=async(url,o={})=>{ const u=String(url); calls.push(u.split('?')[0]);
  const J=(x)=>({ok:true,status:200,json:async()=>x,text:async()=>''});
  if(u.includes('oauth2')) return J({access_token:'t',expires_in:3600});
  if(u.includes('/drive/v3/files?fields=files')){ const nm=decodeURIComponent(u).match(/name='(.*?)' and/)[1]; const par=(decodeURIComponent(u).match(/'(\w+)' in parents/)||[])[1]||'root'; const id=folders.get(par+'/'+nm); return J({files:id?[{id}]:[]}); }
  if(u.includes('drive/v3/files?fields=id')){ const b=JSON.parse(o.body); const id='f'+(++n); folders.set((b.parents?.[0]||'root')+'/'+b.name,id); return J({id}); }
  if(u.includes('uploadType=multipart')) return J({id:'file',name:'x'});
  throw new Error('inesperado '+u); };
const g=require('../src/google');
(async()=>{
  await g.archivePayslip({year:2026,month:9,id:'2',nome:'Teresa Gomes Lopes',buffer:Buffer.from('x')});
  await g.archivePayslip({year:2026,month:9,id:'4',nome:'Fátima/Nunes',buffer:Buffer.from('x')});
  assert.strictEqual(n,5);
  console.log('pastas criadas:',n,'ok; nome seguro:',g.safe('Fátima/Nunes'));
})().catch(e=>{console.error(e.message);process.exit(1)});
