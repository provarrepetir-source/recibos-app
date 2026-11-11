require('dotenv').config?.();
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { extractPages, groupByEmployee } = require('./pdf');
const { loadEmployees } = require('./sheet');
const { matchGroups } = require('./match');

const PASSWORD = process.env.PANEL_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
if (!PASSWORD || !SECRET) { console.error('Defina PANEL_PASSWORD e SESSION_SECRET'); process.exit(1); }

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));

// --- sessão: cookie assinado (HMAC), 8h ---
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]));
function isAuthed(req) {
  const [exp, sig] = (cookie(req).sess || '').split('.');
  return !!exp && !!sig && +exp > Date.now() && eq(sig, sign(exp));
}
const requireAuth = (req, res, next) => isAuthed(req) ? next()
  : (req.path.startsWith('/api/') ? res.status(401).json({ error: 'não autenticado' }) : res.redirect('/login.html'));

// --- limitação de tentativas de login ---
const fails = new Map();
function throttled(ip) { const f = fails.get(ip); return f && f.n >= 5 && Date.now() - f.t < 15 * 60e3; }

app.use((req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); next(); });
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.post('/login', (req, res) => {
  if (throttled(req.ip)) return res.status(429).send('Demasiadas tentativas. Tente daqui a 15 minutos.');
  if (eq(sign(req.body.password || ''), sign(PASSWORD))) {
    fails.delete(req.ip);
    const exp = String(Date.now() + 8 * 3600e3);
    res.set('Set-Cookie', `sess=${exp}.${sign(exp)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`);
    return res.redirect('/');
  }
  const f = fails.get(req.ip) || { n: 0, t: 0 }; fails.set(req.ip, { n: f.n + 1, t: Date.now() });
  res.redirect('/login.html?erro=1');
});
app.post('/logout', (req, res) => { res.set('Set-Cookie', 'sess=; Max-Age=0; Path=/'); res.redirect('/login.html'); });
app.use(requireAuth);

// --- autorização Google (uma vez): mostra o refresh token para guardar nas variáveis do Railway ---
const google = require('./google');
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).send('Falta GOOGLE_CLIENT_ID');
  const state = crypto.randomBytes(16).toString('hex');
  res.set('Set-Cookie', `gstate=${state}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`);
  res.redirect(google.authUrl(state));
});
app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!req.query.state || req.query.state !== cookie(req).gstate) return res.status(400).send('Estado inválido');
    const t = await google.exchangeCode(req.query.code);
    if (!t.refresh_token) return res.status(400).send('A Google não devolveu refresh token. Revogue o acesso em myaccount.google.com/permissions e repita.');
    res.send(`<pre style="font:14px monospace;white-space:pre-wrap;word-break:break-all">Copie para a variável GOOGLE_REFRESH_TOKEN no Railway e depois saia desta página.\nEste valor não volta a ser mostrado.\n\n${t.refresh_token}</pre>`);
  } catch (e) { console.error('oauth falhou:', e.message); res.status(500).send('Falha na autorização Google'); }
});

// --- upload: guarda só em ficheiro temporário, apagado no fim do pedido ---
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const mask = (s, keep = 3) => s ? s.slice(0, keep) + '•'.repeat(Math.max(0, s.length - keep)) : '';

app.post('/api/preview', upload.single('pdf'), async (req, res) => {
  const f = req.file;
  try {
    if (!f) return res.status(400).json({ error: 'Falta o ficheiro PDF' });
    const head = (await fs.readFile(f.path)).subarray(0, 5).toString();
    if (head !== '%PDF-') return res.status(400).json({ error: 'O ficheiro não é um PDF' });
    const pages = await extractPages(f.path);
    const { groups, unreadable } = groupByEmployee(pages);
    const employees = await loadEmployees();
    const rows = matchGroups(groups, employees).map(r => ({ id: r.id, nome: r.nome, paginas: r.pages,
      telemovel: r.phone ? mask(r.phone, 5) : null, nif: r.nif ? mask(r.nif) : null, status: r.status, problemas: r.issues }));
    const naoNoPdf = [...employees.values()].filter(e => e.phone && !groups.some(g => g.id === e.id)).length;
    res.json({ totalPaginas: pages.length, paginasIlegiveis: unreadable, funcionarios: rows,
      resumo: { prontos: rows.filter(r => r.status === 'ok').length, bloqueados: rows.filter(r => r.status !== 'ok').length } , naoNoPdf });
  } catch (e) {
    console.error('preview falhou:', e.message);   // sem conteúdo dos recibos nos logs
    res.status(500).json({ error: 'Não foi possível ler o PDF/folha: ' + e.message });
  } finally { if (f) fs.rm(f.path, { force: true }).catch(() => {}); }
});

const { sendBatch, mode } = require('./send');
let sending = false;
app.get('/api/mode', (req, res) => { try { const m = mode(); res.json({ modo: m.live ? 'REAL' : 'TESTE', teste: m.test ? m.test.slice(0, 5) + '••••' : null }); } catch (e) { res.json({ erro: e.message }); } });
app.post('/api/send', upload.single('pdf'), async (req, res) => {
  const f = req.file;
  if (sending) { if (f) fs.rm(f.path, { force: true }).catch(() => {}); return res.status(409).json({ error: 'Já existe um envio em curso' }); }
  sending = true;
  try {
    if (!f) return res.status(400).json({ error: 'Falta o ficheiro PDF' });
    if (req.body.confirmacao !== 'ENVIAR') return res.status(400).json({ error: 'Falta a confirmação' });
    if ((await fs.readFile(f.path)).subarray(0, 5).toString() !== '%PDF-') return res.status(400).json({ error: 'O ficheiro não é um PDF' });
    const only = req.body.ids ? String(req.body.ids).split(',').map(x => x.trim()).filter(Boolean) : null;
    if (only && !only.length) return res.status(400).json({ error: 'Nenhum funcionário selecionado' });
    const { res: r, out } = await sendBatch(f.path, { force: req.body.reenviar === '1', only });
    res.json({ ...r, linhas: out.map(o => ({ id: o.id, nome: o.nome, estado: o.estado, detalhe: o.detalhe })) });
  } catch (e) { console.error('envio falhou:', e.message); res.status(500).json({ error: e.message }); }
  finally { sending = false; if (f) fs.rm(f.path, { force: true }).catch(() => {}); }
});

app.post('/api/setup-folders', async (req, res) => {
  try { res.json({ ok: true, pastas: Object.keys(await google.setupFolders()) }); }
  catch (e) { console.error('setup pastas:', e.message); res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, '../public')));
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('recibos-app a correr'));
module.exports = app;
