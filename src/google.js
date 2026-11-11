// Cliente Google mínimo (OAuth2 + Sheets + Drive) sem dependências. Âmbitos: leitura de folhas + drive.file
// (drive.file só vê/edita ficheiros criados por esta app — o resto do Drive fica inacessível).
const crypto = require('crypto');
const env = k => process.env[k];
// Com conta de serviço configurada, o OAuth do utilizador pede SÓ drive.file (ficheiros criados pela app).
// A folha é lida pela conta de serviço, que só vê o que lhe for partilhado explicitamente.
const usaContaServico = () => !!(env('GOOGLE_SA_EMAIL') && env('GOOGLE_SA_PRIVATE_KEY'));
const SCOPES = () => usaContaServico()
  ? ['https://www.googleapis.com/auth/drive.file']
  : ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.file'];
let cached = { token: null, exp: 0 };

const redirectUri = () => env('GOOGLE_REDIRECT_URI') || `${env('PUBLIC_URL')}/auth/google/callback`;

function authUrl(state) {
  const p = new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(), response_type: 'code',
    scope: SCOPES().join(' '), access_type: 'offline', prompt: 'consent', state });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...params }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Google OAuth: ' + (j.error_description || j.error || r.status));
  return j;
}
const exchangeCode = code => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60e3) return cached.token;
  if (!env('GOOGLE_REFRESH_TOKEN')) throw new Error('GOOGLE_REFRESH_TOKEN não definido (autorize em /auth/google)');
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: env('GOOGLE_REFRESH_TOKEN') });
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

// --- conta de serviço (JWT RS256, sem dependências) ---
let saCached = { token: null, exp: 0 };
const b64u = b => Buffer.from(b).toString('base64url');
async function saAccessToken() {
  if (saCached.token && Date.now() < saCached.exp - 60e3) return saCached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: env('GOOGLE_SA_EMAIL'), scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const key = env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n');
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Conta de serviço: ' + (j.error_description || j.error || r.status));
  saCached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return saCached.token;
}

async function api(url, opts = {}, tokenFn = accessToken) {
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + await tokenFn(), ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Google API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// --- Sheets ---
async function readSheetValues(spreadsheetId, range = 'A:D') {
  const j = await api(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`, {},
    usaContaServico() ? saAccessToken : accessToken);
  return j.values || [];
}

// --- Drive ---
const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
async function findOrCreateFolder(name, parentId) {
  const query = `name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false` + (parentId ? ` and '${parentId}' in parents` : '');
  // pasta de topo: procura em qualquer sítio (o utilizador pode tê-la movido; drive.file só mostra pastas criadas pela app)
  const f = await api('https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(query));
  if (f.files.length) return f.files[0].id;
  return (await api('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }) })).id;
}
async function ensurePath(parts) { let id = null; for (const p of parts) id = await findOrCreateFolder(p, id); return id; }

async function uploadFile(parentId, name, mimeType, buffer) {
  const b = 'rec' + Date.now().toString(36);
  const meta = JSON.stringify({ name, parents: [parentId] });
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${mimeType}\r\n\r\n`), buffer, Buffer.from(`\r\n--${b}--`)]);
  return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
}

const ROOT_RECIBOS = () => env('ARCHIVE_ROOT') || 'Recibos de Vencimento';
const ROOT_PROVAS = () => env('PROOFS_ROOT') || 'Comprovativos de Envio';
async function setupFolders() {
  const out = {};
  for (const n of [ROOT_RECIBOS(), ROOT_PROVAS()]) out[n] = await findOrCreateFolder(n, null);
  return out;
}
const safe = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]+/g, '_').trim();
// Recibos de Vencimento/AAAA/MM/<Id - Nome>/recibo-AAAA-MM.pdf
async function archivePayslip({ year, month, id, nome, buffer, fileName }) {
  const mm = String(month).padStart(2, '0');
  const dir = await ensurePath([ROOT_RECIBOS(), String(year), mm, `${id} - ${safe(nome)}`]);
  return uploadFile(dir, fileName || `recibo-${year}-${mm}.pdf`, 'application/pdf', buffer);
}
async function payslipExists({ year, month, id, nome }) {
  const mm = String(month).padStart(2, '0');
  const dir = await ensurePath([ROOT_RECIBOS(), String(year), mm, `${id} - ${safe(nome)}`]);
  const q2 = `'${dir}' in parents and name='recibo-${year}-${mm}.pdf' and trashed=false`;
  return (await api('https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(q2))).files.length > 0;
}
async function archiveReport({ year, month, csv }) {
  const mm = String(month).padStart(2, '0');
  const dir = await ensurePath([ROOT_PROVAS(), String(year), mm]);
  return uploadFile(dir, `relatorio-envio-${year}-${mm}-${Date.now()}.csv`, 'text/csv', Buffer.from('﻿' + csv, 'utf8'));
}

module.exports = { authUrl, exchangeCode, readSheetValues, archivePayslip, archiveReport, payslipExists, setupFolders, ensurePath, uploadFile, safe };
