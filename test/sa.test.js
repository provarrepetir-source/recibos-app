// Conta de serviço: o JWT tem de ter assinatura RS256 válida; a folha é lida com o token da conta de serviço
const crypto = require('crypto'); const assert = require('assert');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_EMAIL = 'leitor@proj.iam.gserviceaccount.com';
process.env.GOOGLE_SA_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'); // como vem do JSON
process.env.GOOGLE_CLIENT_ID = 'c'; process.env.PUBLIC_URL = 'https://x';
const seen = [];
global.fetch = async (url, o = {}) => { url = String(url); const J = x => ({ ok: true, status: 200, json: async () => x });
  if (url.includes('oauth2.googleapis.com/token')) {
    const a = new URLSearchParams(o.body).get('assertion'); const [h, c, s] = a.split('.');
    assert(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url')), 'assinatura inválida');
    const claim = JSON.parse(Buffer.from(c, 'base64url')); assert.strictEqual(claim.iss, process.env.GOOGLE_SA_EMAIL);
    assert(claim.scope.endsWith('spreadsheets.readonly')); return J({ access_token: 'sa-token', expires_in: 3600 }); }
  seen.push([url, o.headers.Authorization]); return J({ values: [['Id', 'Nome', 'NIF', 'Telemóvel'], ['2', 'Ana', '234451343', '969772118']] }); };
const g = require('../src/google');
(async () => {
  const v = await g.readSheetValues('SHEETID'); assert.strictEqual(v.length, 2);
  assert.strictEqual(seen[0][1], 'Bearer sa-token');
  const u = new URL(g.authUrl('st')); assert.strictEqual(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
  console.log('conta de serviço OK; OAuth só pede:', u.searchParams.get('scope'));
})().catch(e => { console.error(e); process.exit(1); });
