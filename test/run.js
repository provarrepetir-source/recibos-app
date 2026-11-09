// Teste de ponta a ponta com ficheiros reais passados por argumento: node test/run.js <pdf> <csv>
const { extractPages, groupByEmployee, buildProtectedPdf, sha256 } = require('../src/pdf');
const { fromRows, parseCsv } = require('../src/sheet');
const { matchGroups } = require('../src/match');
const fs = require('fs'); const assert = require('assert');
(async () => {
  const [pdf, csv] = process.argv.slice(2);
  const { groups, unreadable } = groupByEmployee(await extractPages(pdf));
  const m = matchGroups(groups, fromRows(parseCsv(fs.readFileSync(csv, 'utf8'))));
  console.log('funcionários:', groups.length, 'ilegíveis:', unreadable.length, 'ok:', m.filter(x => x.status === 'ok').length, 'bloqueados:', m.filter(x => x.status !== 'ok').length);
  const multi = groups.filter(g => g.pages.length > 1).map(g => g.id); console.log('com vários recibos (Ids):', multi.join(','));
  const motivos = {}; m.forEach(x => x.issues.forEach(i => motivos[i] = (motivos[i] || 0) + 1)); console.log(motivos);
  const g = groups.find(x => x.pages.length > 1);
  const buf = await buildProtectedPdf(pdf, g.pages, '123456789');
  fs.writeFileSync('/tmp/t.pdf', buf);
  const { execFileSync } = require('child_process');
  assert.throws(() => execFileSync('qpdf', ['--check', '/tmp/t.pdf'], { stdio: 'pipe' }));            // sem password falha
  const out = execFileSync('qpdf', ['--password=123456789', '--show-npages', '/tmp/t.pdf']).toString().trim();
  assert.strictEqual(+out, g.pages.length); console.log('cifrado OK, páginas:', out, 'sha256:', sha256(buf).slice(0, 12)); fs.rmSync('/tmp/t.pdf');
})().catch(e => { console.error(e); process.exit(1); });
