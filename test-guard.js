// Anti-spam : plafonds, ralentissement, blocages progressifs, comptes à l'essai, défi anti-robot, puis intégration HTTP.
const assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
const { Guard, mask, clientIp } = require('./guard.js'), { createServer } = require('./server.js');
let t = 1e6; const now = () => t;
const g = Guard({ now, minFillMs: 1000, limits: { post: { acct: 10, ip: 100 } } });
// ralentissement progressif puis blocage
let delays = []; for (let i = 0; i < 10; i++) delays.push(g.hit('post', { ip: '1.2.3.4', acct: 'zoe' }));
assert.strictEqual(delays[0], 0); assert.ok(delays[9] > delays[6] && delays[9] <= 3000);
assert.throws(() => g.hit('post', { ip: '1.2.3.4', acct: 'zoe' }), e => e.code === 429 && e.retry === 60);
assert.throws(() => g.hit('post', { ip: '9.9.9.9', acct: 'ZOE' }), e => e.code === 429); // le blocage suit le compte, pas l'IP
assert.strictEqual(g.hit('post', { ip: '1.2.3.4', acct: 'max' }), 0); // un autre compte n'est pas touché
const bl = g.list(); assert.strictEqual(bl.length, 1); assert.strictEqual(bl[0].who, 'zoe'); assert.strictEqual(bl[0].scope, 'acct');
t += 61000; assert.strictEqual(g.list().length, 0); // blocage expiré
for (let i = 0; i < 10; i++) g.hit('post', { acct: 'zoe' });
assert.throws(() => g.hit('post', { acct: 'zoe' }), e => e.retry === 120); // récidive : durée doublée
assert.ok(g.unblock(g.list()[0].id)); assert.strictEqual(g.hit('post', { acct: 'zoe' }), 0); assert.strictEqual(g.unblock(999), false);
// période probatoire : plafond réduit à 40 %
for (let i = 0; i < 4; i++) g.hit('post', { acct: 'neo', probation: true });
assert.throws(() => g.hit('post', { acct: 'neo', probation: true }), e => e.code === 429);
// IP : inscriptions
for (let i = 0; i < 5; i++) g.hit('signup', { ip: '5.5.5.5' });
assert.throws(() => g.hit('signup', { ip: '5.5.5.5' }), e => e.code === 429);
// défi anti-robot : usage unique, délai minimal, champ piège
const ans = c => { const m = /(\d+) cornichons (plus|moins) (\d+)/.exec(c.question); return String(m[2] === 'plus' ? +m[1] + +m[3] : m[1] - m[3]); };
let c = g.challenge(); t += 1500; assert.throws(() => g.verify({ id: c.id, answer: '999' }), /Mauvaise/);
assert.throws(() => g.verify({ id: c.id, answer: ans(c) }), /expiré/); // déjà consommé
c = g.challenge(); assert.throws(() => g.verify({ id: c.id, answer: ans(c) }), /rapide/);
c = g.challenge(); t += 1500; assert.throws(() => g.verify({ id: c.id, answer: ans(c), website: 'http://spam' }), /échoué/);
c = g.challenge(); t += 1500; g.verify({ id: c.id, answer: ans(c) });
c = g.challenge(); t += 11 * 60000; assert.throws(() => g.verify({ id: c.id, answer: ans(c) }), /expiré/);
assert.strictEqual(mask('192.168.4.77'), '192.168.4.•'); assert.strictEqual(Guard({ enabled: false }).hit('post', { acct: 'a' }), 0);
assert.strictEqual(clientIp({ socket: { remoteAddress: '8.8.8.8' }, headers: { 'x-forwarded-for': '1.1.1.1' } }), '8.8.8.8'); // en-tête ignoré hors relais local
assert.strictEqual(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.1.1.1' } }), '1.1.1.1');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cornichon-g-'));
  const srv = createServer({ db: ':memory:', authPerMin: 1000, captchaMinMs: 0, spamLimits: { post: { acct: 5 }, login: { acct: 50 } } });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok)); const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (p, tok, data) => { const r = await fetch(base + p, { method: data === undefined ? 'GET' : 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: data === undefined ? undefined : JSON.stringify(data) }); return Object.assign(await r.json(), { status: r.status }); };
  const signup = async (name, captcha) => call('/api/signup', null, { name, password: 'secret1', captcha });
  assert.strictEqual((await signup('ana')).status, 400); // sans défi
  const ch = await call('/api/captcha'); assert.ok(ch.id && ch.question);
  assert.strictEqual((await signup('ana', { id: ch.id, answer: '0' })).status, 400);
  const c2 = await call('/api/captcha'), a = await signup('ana', { id: c2.id, answer: ans(c2) }); assert.strictEqual(a.status, 200);
  assert.strictEqual((await signup('ana', { id: c2.id, answer: ans(c2) })).status, 400); // défi à usage unique
  // quota de posts d'un compte à l'essai : 40 % de 5 → 2
  assert.strictEqual((await call('/api/call', a.token, { method: 'post', args: ['un'] })).status, 200);
  assert.strictEqual((await call('/api/call', a.token, { method: 'post', args: ['deux'] })).status, 200);
  const over = await call('/api/call', a.token, { method: 'post', args: ['trois'] }); assert.strictEqual(over.status, 429); assert.ok(/bloqué/.test(over.error));
  assert.notStrictEqual((await call('/api/call', a.token, { method: 'send', args: ['ana', 'x'] })).status, 429); // messages : règle propre, non touchée par les posts
  // écran admin : réservé au Streamer
  assert.strictEqual((await call('/api/admin/spam', a.token)).status, 403);
  const st = await call('/api/stream-session', null, {}); const adm = await call('/api/admin/spam', st.token);
  assert.strictEqual(adm.status, 200); assert.ok(adm.blocks.some(b => b.who === 'ana' && b.rule === 'post')); assert.ok(adm.trial.some(u => u.name === 'ana')); assert.ok(adm.stats.captchaFail >= 2);
  assert.strictEqual((await call('/api/admin/spam-unblock', st.token, { id: adm.blocks[0].id })).status, 200);
  assert.strictEqual((await call('/api/admin/spam-unblock', st.token, { id: adm.blocks[0].id })).status, 404);
  assert.strictEqual((await call('/api/call', a.token, { method: 'post', args: ['quatre'] })).status, 200);
  // inscriptions par IP : 5 par heure
  let last; for (let i = 0; i < 6; i++) last = await signup('bot' + i); assert.strictEqual(last.status, 429);
  srv.close(); console.log('test-guard OK');
})().catch(e => { console.error(e); process.exit(1); });
