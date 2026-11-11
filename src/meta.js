// WhatsApp Cloud API: upload do PDF + envio do template com cabeçalho de documento
const V = () => process.env.GRAPH_VERSION || 'v21.0';
const tok = () => process.env.WHATSAPP_TOKEN;
const pid = () => process.env.PHONE_NUMBER_ID;

async function graph(url, opts, ctx = '') {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j.error || {};
    // error_data.details traz o pormenor (ex.: "template name (x) does not exist in pt_PT"); ctx indica o que a app enviou
    const det = e.error_data?.details;
    const txt = [e.error_user_msg || e.message || 'erro', det && det !== e.message ? det : null].filter(Boolean).join(' | ');
    throw new Error(`Meta ${r.status} code=${e.code || '?'}: ${txt}${ctx}`);   // nunca inclui conteúdo do recibo
  }
  return j;
}

async function uploadPdf(buffer, filename) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', 'application/pdf');
  fd.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
  return (await graph(`https://graph.facebook.com/${V()}/${pid()}/media`, { method: 'POST', headers: { Authorization: `Bearer ${tok()}` }, body: fd })).id;
}

// Devolve o ID da mensagem (wamid) aceite pela Meta
async function sendPayslip({ to, mediaId, filename, nome, mes }) {
  const body = {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {
      name: process.env.WA_TEMPLATE || 'recibo_vencimento',
      language: { code: process.env.WA_TEMPLATE_LANG || 'pt_PT' },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] },
        { type: 'body', parameters: [
          { type: 'text', parameter_name: 'nome_empregado', text: nome },
          { type: 'text', parameter_name: 'mes', text: mes } ] }
      ]
    }
  };
  const j = await graph(`https://graph.facebook.com/${V()}/${pid()}/messages`, { method: 'POST',
    headers: { Authorization: `Bearer ${tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    ` [modelo=${body.template.name} idioma=${body.template.language.code}]`);
  return j.messages?.[0]?.id;
}
// --- Diagnóstico: a que contas WhatsApp Business o token tem acesso, e onde está o número e o template configurados ---
async function getJson(path, params = {}) {
  const u = new URL(`https://graph.facebook.com/${V()}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return graph(u, { headers: { Authorization: `Bearer ${tok()}` } });
}
async function diagnose() {
  const tryIt = async fn => { try { return await fn(); } catch (e) { return { erro: e.message.slice(0, 300) }; } };
  const tplName = process.env.WA_TEMPLATE || 'recibo_vencimento', tplLang = process.env.WA_TEMPLATE_LANG || 'pt_PT';
  const out = { configurado: { phoneNumberId: pid() || null, modelo: tplName, idioma: tplLang } };
  out.numero = await tryIt(() => getJson(pid(), { fields: 'display_phone_number,verified_name,quality_rating' }));
  const dbg = await tryIt(() => getJson('debug_token', { input_token: tok() }));
  const d = dbg.data || {};
  out.token = dbg.erro ? { erro: dbg.erro } : { tipo: d.type, valido: d.is_valid, expira: d.expires_at ? new Date(d.expires_at * 1000).toISOString().slice(0, 10) : 'nunca', scopes: d.scopes };
  const ids = new Set();
  for (const g of d.granular_scopes || []) if (/^whatsapp_business_(management|messaging)$/.test(g.scope)) (g.target_ids || []).forEach(x => ids.add(String(x)));
  if (process.env.WABA_ID) ids.add(process.env.WABA_ID.trim());
  out.contas = [];
  for (const id of ids) {
    const info = await tryIt(() => getJson(id, { fields: 'name' }));
    const nums = await tryIt(() => getJson(`${id}/phone_numbers`, { fields: 'id,display_phone_number,verified_name', limit: 50 }));
    const tpls = await tryIt(() => getJson(`${id}/message_templates`, { fields: 'name,language,status', limit: 100 }));
    out.contas.push({
      id, nome: info.name || info.erro || null,
      temOMeuNumero: nums.data ? nums.data.some(n => String(n.id) === String(pid())) : null,
      numeros: nums.data ? nums.data.map(n => `${n.id} · ${n.display_phone_number} · ${n.verified_name}`) : nums,
      templates: tpls.data ? tpls.data.map(t => `${t.name} [${t.language}] ${t.status}`) : tpls,
      reciboNestaConta: tpls.data ? tpls.data.filter(t => t.name === tplName).map(t => `${t.language} ${t.status}`) : null,
    });
  }
  const c = [];
  const dono = out.contas.find(x => x.temOMeuNumero);
  if (!out.contas.length) c.push('Não consegui listar contas WhatsApp Business com este token (ver "token" e "contas"). Se souber o ID da conta, defina WABA_ID no Railway.');
  else if (!dono) c.push('O PHONE_NUMBER_ID configurado NÃO pertence a nenhuma das contas listadas. Use o ID de um número de uma destas contas (ver "numeros").');
  else {
    c.push(`O número configurado pertence à conta ${dono.id} (${dono.nome}).`);
    const r = dono.reciboNestaConta;
    if (r && !r.length) c.push(`Nessa conta NÃO existe o modelo "${tplName}". Está noutra conta ou ainda não foi criado aí.`);
    else if (r) c.push(`Nessa conta existe "${tplName}": ${r.join(' / ')}. ${r.some(x => x.startsWith(tplLang + ' ')) ? 'O idioma configurado existe.' : `O idioma configurado (${tplLang}) NÃO está entre estes.`}`);
  }
  const outras = out.contas.filter(x => x !== dono && x.reciboNestaConta && x.reciboNestaConta.length);
  for (const o of outras) c.push(`O modelo "${tplName}" existe na conta ${o.id} (${o.nome}): ${o.reciboNestaConta.join(' / ')}.`);
  out.conclusao = c;
  return out;
}
module.exports = { uploadPdf, sendPayslip, diagnose };
