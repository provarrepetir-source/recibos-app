// Fonte dos empregados. Colunas esperadas: Id | Nome | NIF | Telemóvel
// Fase 1: CSV. Fase 2: Google Sheets via OAuth (mesma interface: loadEmployees()).
const fs = require('fs/promises');

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const digits = s => String(s || '').replace(/\D/g, '');

function normalizePhone(raw) {
  let d = digits(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && /^[239]/.test(d)) d = '351' + d;   // por omissão +351
  return /^\d{11,15}$/.test(d) ? d : null;
}

// NIF português: 9 dígitos + dígito de controlo (módulo 11)
function validNif(n) {
  if (!/^\d{9}$/.test(n)) return false;
  const s = [...n.slice(0, 8)].reduce((a, c, i) => a + (+c) * (9 - i), 0);
  const chk = 11 - (s % 11);
  return (chk >= 10 ? 0 : chk) === +n[8];
}

function fromRows(rows) {
  const hi = rows.findIndex(r => r.some(c => /^id$/i.test(c.trim())) && r.some(c => /nif/i.test(c)));
  if (hi < 0) throw new Error('Cabeçalho não encontrado (esperado: Id, Nome, NIF, Telemóvel)');
  const h = rows[hi].map(c => c.trim().toLowerCase());
  const col = re => h.findIndex(c => re.test(c));
  const iId = col(/^id$/), iNome = col(/^nome/), iNif = col(/^nif/), iTel = col(/telem|contacto|telef/);
  const map = new Map();
  for (const r of rows.slice(hi + 1)) {
    const id = (r[iId] || '').trim();
    if (!/^\d+$/.test(id)) continue;
    map.set(id, { id, nome: (r[iNome] || '').trim(), nif: digits(r[iNif]), phone: normalizePhone(r[iTel]), phoneRaw: r[iTel] || '' });
  }
  return map;
}

async function loadEmployees() {
  if (process.env.EMPLOYEES_SHEET_ID) return fromRows(await require('./google').readSheetValues(process.env.EMPLOYEES_SHEET_ID, process.env.EMPLOYEES_RANGE || 'A:D'));
  if (process.env.SHEET_CSV_PATH) return fromRows(parseCsv(await fs.readFile(process.env.SHEET_CSV_PATH, 'utf8')));
  throw new Error('Fonte de empregados não configurada (SHEET_CSV_PATH ou Google Sheets)');
}

module.exports = { loadEmployees, fromRows, parseCsv, normalizePhone, validNif };
