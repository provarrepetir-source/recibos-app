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
module.exports = { uploadPdf, sendPayslip };
