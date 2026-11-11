// node test/send.test.js <pdf> <csv>  — meta e google simulados
const assert = require('assert');
process.env.TEST_PHONE = '351900000000'; process.env.SEND_DELAY_MS = '0'; process.env.SHEET_CSV_PATH = process.argv[3];
const { sendBatch } = require('../src/send');
const sent = [], arch = [];
const deps = {
  meta: { uploadPdf: async b => 'media' + b.length, sendPayslip: async a => { sent.push(a); return 'wamid.' + sent.length; } },
  google: { payslipExists: async () => false, archivePayslip: async a => arch.push(a), archiveReport: async ({ csv }) => ({ id: 'r', csv }) },
};
(async () => {
  const { res, out, csv } = await sendBatch(process.argv[2], { deps });
  console.log(res);
  assert.strictEqual(res.modo, 'TESTE');
  assert(sent.length > 0 && sent.every(s => s.to === '351900000000'), 'tudo para o número de teste');
  assert.strictEqual(arch.length, sent.length);
  assert(sent[0].mes.endsWith('2026') && /^[A-ZÀ-Ú]/.test(sent[0].nome));
  assert(csv.split('\n').length === out.length + 1);
  // segunda corrida: já enviado → não repete
  deps.google.payslipExists = async () => true; sent.length = 0;
  const r2 = await sendBatch(process.argv[2], { deps }); assert.strictEqual(sent.length, 0); console.log('2ª corrida:', r2.res.enviados, 'enviados');
  // só selecionados
  deps.google.payslipExists = async () => false; sent.length = 0;
  const r3 = await sendBatch(process.argv[2], { deps, only: ['2'] });
  assert.strictEqual(sent.length, 1); assert.strictEqual(r3.out.filter(o => /aceite/.test(o.estado)).length, 1); console.log('só 1 selecionado: ok');
  // reenvio de um recibo já arquivado: exige force e arquiva com nome novo
  deps.google.payslipExists = async () => true; sent.length = 0; arch.length = 0;
  await sendBatch(process.argv[2], { deps, only: ['2'] }); assert.strictEqual(sent.length, 0);
  const r4 = await sendBatch(process.argv[2], { deps, only: ['2'], force: true });
  assert.strictEqual(sent.length, 1); assert(/reenvio/.test(arch[0].fileName)); assert(/REENVIO/.test(r4.out.find(o => o.wamid).estado)); console.log('reenvio forçado: ok');
  // limite de meses (PDF é de setembro de 2026)
  const { periodoPermitido } = require('../src/send');
  const P = { ano: 2026, mes: 9 };
  assert(periodoPermitido(P, new Date('2026-09-15'))); assert(periodoPermitido(P, new Date('2027-01-31')));
  assert(!periodoPermitido(P, new Date('2027-02-01'))); assert(!periodoPermitido(P, new Date('2026-08-31')));
  await assert.rejects(sendBatch(process.argv[2], { deps, now: new Date('2027-06-01') }), /fora do permitido/); console.log('limite de 4 meses: ok');
  // sem TEST_PHONE nem SEND_LIVE: recusa
  delete process.env.TEST_PHONE; await assert.rejects(sendBatch(process.argv[2], { deps }), /TEST_PHONE/);
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
