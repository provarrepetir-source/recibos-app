// node test/meta.test.js — fetch simulado: o erro 132001 tem de mostrar o pormenor da Meta e o modelo/idioma enviados
const assert = require('assert');
process.env.WHATSAPP_TOKEN = 't'; process.env.PHONE_NUMBER_ID = '123'; process.env.WA_TEMPLATE = 'recibo_vencimento'; process.env.WA_TEMPLATE_LANG = 'pt_PT';
const meta = require('../src/meta');
(async () => {
  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: '(#132001) Template name does not exist in the translation', code: 132001,
    error_data: { messaging_product: 'whatsapp', details: 'template name (recibo_vencimento) does not exist in pt_PT' } } }) });
  await assert.rejects(meta.sendPayslip({ to: '351900000000', mediaId: 'm', filename: 'f.pdf', nome: 'Ana', mes: 'setembro de 2026' }), e => {
    console.log(e.message);
    return /code=132001/.test(e.message) && /does not exist in pt_PT/.test(e.message) && /\[modelo=recibo_vencimento idioma=pt_PT\]/.test(e.message); });
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
  assert.strictEqual(await meta.sendPayslip({ to: '1', mediaId: 'm', filename: 'f', nome: 'A', mes: 'm' }), 'wamid.1');
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
