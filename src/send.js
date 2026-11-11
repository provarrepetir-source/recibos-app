// Orquestra o envio. Segurança: sem SEND_LIVE=true, TUDO vai para TEST_PHONE (nunca para empregados).
const { extractPages, groupByEmployee, buildProtectedPdf, sha256, periodoDoPdf } = require('./pdf');
const { loadEmployees } = require('./sheet');
const { matchGroups } = require('./match');
const meta = require('./meta');
const google = require('./google');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const csvCell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// Só aceita o mês corrente e até MAX_MESES_ATRAS meses para trás (por omissão 4); nunca meses futuros
function periodoPermitido(periodo, now = new Date()) {
  const max = +process.env.MAX_MESES_ATRAS || 4;
  const diff = (now.getFullYear() * 12 + now.getMonth() + 1) - (periodo.ano * 12 + periodo.mes);
  return diff >= 0 && diff <= max;
}

function mode() {
  const live = process.env.SEND_LIVE === 'true';
  const test = (process.env.TEST_PHONE || '').replace(/\D/g, '');
  if (!live && !test) throw new Error('Defina TEST_PHONE (modo de teste) ou SEND_LIVE=true');
  return { live, test };
}

async function sendBatch(pdfPath, { deps = { meta, google }, force = false, only = null, now = new Date() } = {}) {
  const { live, test } = mode();
  const pages = await extractPages(pdfPath);
  const periodo = periodoDoPdf(pages);
  if (!periodo) throw new Error('Não foi possível determinar um único mês/ano no PDF');
  if (!periodoPermitido(periodo, now)) throw new Error(`O mês ${periodo.label} está fora do permitido (mês atual e até ${+process.env.MAX_MESES_ATRAS || 4} meses para trás)`);
  const { groups } = groupByEmployee(pages);
  const rows = matchGroups(groups, await loadEmployees()).filter(r => !only || only.includes(r.id));
  const out = [];
  for (const r of rows) {
    const rec = { id: r.id, nome: r.nome, paginas: r.pages.join(' '), destino: '', quando: '', wamid: '', sha256: '', estado: '', detalhe: '' };
    try {
      if (r.status !== 'ok') { rec.estado = 'não enviado'; rec.detalhe = r.issues.join('; '); out.push(rec); continue; }
      const jaExiste = await deps.google.payslipExists({ year: periodo.ano, month: periodo.mes, id: r.id, nome: r.nome });
      if (jaExiste && !force) { rec.estado = 'não enviado'; rec.detalhe = 'já enviado neste mês (arquivo existe)'; out.push(rec); continue; }
      const buf = await buildProtectedPdf(pdfPath, r.pages, r.nif);
      rec.sha256 = sha256(buf);
      const filename = `recibo-${periodo.ano}-${String(periodo.mes).padStart(2, '0')}.pdf`;
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
      await deps.google.archivePayslip({ year: periodo.ano, month: periodo.mes, id: r.id, nome: r.nome, buffer: buf,
        fileName: jaExiste ? `recibo-${periodo.ano}-${String(periodo.mes).padStart(2, '0')}-reenvio-${stamp}.pdf` : undefined });
      rec.destino = live ? r.phone : test;
      const mediaId = await deps.meta.uploadPdf(buf, filename);
      rec.wamid = await deps.meta.sendPayslip({ to: rec.destino, mediaId, filename, nome: r.nome.split(' ')[0], mes: periodo.label });
      rec.quando = new Date().toISOString();
      rec.estado = (jaExiste ? 'REENVIO ' : '') + (live ? 'aceite pela Meta' : 'TESTE aceite pela Meta');
    } catch (e) { rec.estado = 'FALHOU'; rec.detalhe = e.message.slice(0, 400); }
    out.push(rec);
    await sleep(+process.env.SEND_DELAY_MS || 1000);
  }
  const cols = ['id', 'nome', 'paginas', 'destino', 'quando', 'wamid', 'sha256', 'estado', 'detalhe'];
  const csv = cols.join(',') + '\n' + out.map(o => cols.map(c => csvCell(o[c])).join(',')).join('\n');
  let relatorio = null;
  try { relatorio = await deps.google.archiveReport({ year: periodo.ano, month: periodo.mes, csv }); } catch (e) { relatorio = { erro: e.message }; }
  const res = { periodo: periodo.label, modo: live ? 'REAL' : 'TESTE', enviados: out.filter(o => /aceite/.test(o.estado)).length,
    falhas: out.filter(o => o.estado === 'FALHOU').length, naoEnviados: out.filter(o => o.estado === 'não enviado').length, relatorio: !!relatorio?.id };
  return { res, out, csv };
}
module.exports = { sendBatch, mode, periodoPermitido };
