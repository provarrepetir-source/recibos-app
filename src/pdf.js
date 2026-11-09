// Extração, agrupamento, divisão e proteção por password. Usa qpdf e pdftotext (execFile, sem shell).
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const run = promisify(execFile);

const RE_ID = /Funcion[aá]rio:\s*(\d+)\s*-\s*(.+?)(?:\s{2,}|\n)/;
const RE_NIF = /N[ºo°]\.\s*Contrib\.:\s*(\d{9})/;

async function extractPages(pdfPath) {
  const { stdout } = await run('pdftotext', ['-layout', pdfPath, '-'], { maxBuffer: 64 * 1024 * 1024 });
  const pages = stdout.split('\f');
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  return pages.map((text, i) => {
    const id = text.match(RE_ID);
    const nif = text.match(RE_NIF);
    return { page: i + 1, id: id ? id[1] : null, name: id ? id[2].trim() : null, nif: nif ? nif[1] : null };
  });
}

// Agrupa por Id de funcionário (um funcionário pode ter vários recibos)
function groupByEmployee(pages) {
  const groups = new Map();
  const unreadable = [];
  for (const p of pages) {
    if (!p.id) { unreadable.push(p.page); continue; }
    if (!groups.has(p.id)) groups.set(p.id, { id: p.id, name: p.name, nifs: new Set(), pages: [] });
    const g = groups.get(p.id);
    g.pages.push(p.page);
    if (p.nif) g.nifs.add(p.nif);
  }
  return { groups: [...groups.values()].map(g => ({ ...g, nifs: [...g.nifs] })), unreadable };
}

async function withTmp(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rec-'));
  try { return await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

// Devolve Buffer com as páginas indicadas, cifrado (AES-256) com a password dada (NIF)
async function buildProtectedPdf(srcPath, pageNumbers, password) {
  return withTmp(async dir => {
    const out = path.join(dir, 'out.pdf');
    await run('qpdf', [srcPath, '--pages', '.', pageNumbers.join(','), '--',
      `--encrypt`, password, password, '256', '--print=full', '--modify=none', '--', out]);
    return fs.readFile(out);
  });
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

module.exports = { extractPages, groupByEmployee, buildProtectedPdf, sha256 };
