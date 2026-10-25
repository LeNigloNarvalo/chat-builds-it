// Test d'intégration : vrai serveur HTTP + base SQLite temporaire, deux « appareils » pour la même personne.
const assert = require('assert'), os = require('os'), path = require('path'), fs = require('fs');
const { createServer } = require('./server.js'), Social = require('./social.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cornichon-')), dbFile = path.join(dir, 't.db');
const outbox = [], server = createServer({ db: dbFile, authPerMin: 1000, publicUrl: 'http://x.test', mail: (to, subject, text) => outbox.push({ to, subject, text }) });
(async () => {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (p, tok, data, method) => {
    const r = await fetch(base + p, { method: method || (data === undefined ? 'GET' : 'POST'), headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: data === undefined ? undefined : JSON.stringify(data) });
    return Object.assign(await r.json(), { status: r.status });
  };
  const act = (tok, method, ...args) => call('/api/call', tok, { method, args });
  // comptes + sessions
  const a1 = await call('/api/signup', null, { name: 'alice', password: 'secret1', bio: 'hi' }); assert.ok(a1.token && a1.token.length === 64);
  assert.strictEqual((await call('/api/signup', null, { name: 'ALICE', password: 'secret1' })).status, 400);
  const a2 = await call('/api/login', null, { name: 'alice', password: 'secret1' }); assert.notStrictEqual(a1.token, a2.token);
  assert.strictEqual((await call('/api/login', null, { name: 'alice', password: 'faux' })).status, 400);
  const b = await call('/api/signup', null, { name: 'bob', password: 'secret2' });
  assert.strictEqual((await call('/api/state')).status, 401);
  assert.strictEqual((await call('/api/state', 'f'.repeat(64))).status, 401);
  // l'utilisateur vient de la session, jamais de la requête
  const p = await act(a1.token, 'post', 'bonjour #cornichon'); assert.strictEqual(p.result.author, 'alice');
  // synchro multi-appareils : le 2e appareil d'alice et bob voient le post
  let s = await call('/api/state?v=-1', a2.token); assert.strictEqual(s.state.posts.length, 1); assert.strictEqual(s.me, 'alice');
  assert.strictEqual((await call('/api/state?v=' + s.version, a2.token)).unchanged, true);
  await act(b.token, 'send', 'alice', 'secret msg');
  await act(b.token, 'toggleLike', p.result.id);
  s = await call('/api/state?v=-1', a2.token); assert.strictEqual(s.state.messages.length, 1); assert.strictEqual(s.state.posts[0].likes[0], 'bob');
  // confidentialité : pas de mots de passe, pas de messages ni listes privées d'autrui
  await act(b.token, 'toggleBookmark', p.result.id);
  const sb = await call('/api/state?v=-1', b.token), txt = JSON.stringify(sb.state);
  assert.ok(!txt.includes('"pass"') && !txt.includes('secret1') && !txt.includes('$'));
  assert.deepStrictEqual(s.state.users.bob.bookmarks, undefined); assert.strictEqual(sb.state.users.bob.bookmarks.length, 1);
  const c = await call('/api/signup', null, { name: 'carol', password: 'secret3' });
  assert.strictEqual((await call('/api/state?v=-1', c.token)).state.messages.length, 0);
  // le moteur client lit bien la vue reçue
  const mem = { d: { [Social.KEY]: JSON.stringify(sb.state) }, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; } };
  assert.strictEqual(Social.Net(mem).explore('bob').length, 1);
  // actions réservées / invalides
  assert.strictEqual((await act(b.token, 'moderate', 1, 'ban')).status, 400);
  assert.strictEqual((await act(b.token, 'signup', 'x')).status, 400);
  assert.strictEqual((await act(b.token, '__proto__')).status, 400);
  assert.strictEqual((await call('/api/stream-session', null, {})).status, 200); // 127.0.0.1 : machine du stream
  // changement de mot de passe : l'ancienne session des autres appareils meurt, le nouveau token fonctionne
  const np = await call('/api/password', a1.token, { oldPw: 'secret1', newPw: 'nouveau1' });
  assert.ok(np.token); assert.strictEqual((await call('/api/state', a2.token)).status, 401); assert.strictEqual((await call('/api/state', a1.token)).status, 401);
  assert.strictEqual((await call('/api/state', np.token)).status, 200);
  assert.strictEqual((await call('/api/login', null, { name: 'alice', password: 'nouveau1' })).status, 200);
  // déconnexion partout + suppression de compte
  const l = await call('/api/login', null, { name: 'alice', password: 'nouveau1' });
  await call('/api/logout-all', l.token, {}); assert.strictEqual((await call('/api/state', l.token)).status, 401);
  assert.strictEqual((await call('/api/delete-account', c.token, { password: 'mauvais' })).status, 400);
  assert.strictEqual((await call('/api/delete-account', c.token, { password: 'secret3' })).status, 200);
  assert.strictEqual((await call('/api/state', c.token)).status, 401);
  // fichiers : seule la liste blanche est servie (jamais la base ni le serveur)
  for (const f of ['/server.js', '/data/cornichon.db', '/test.js', '/../package.json']) assert.strictEqual((await fetch(base + f)).status, 404);
  assert.strictEqual((await fetch(base + '/sync.js')).status, 200); assert.ok((await (await fetch(base + '/')).text()).includes('Cornichon'));
  // temps réel (SSE) : annonce des changements + « écrit… », sans interrogation
  const evs = [], ac = new AbortController();
  const sr = await fetch(base + '/api/stream', { headers: { Authorization: 'Bearer ' + b.token }, signal: ac.signal }); assert.strictEqual(sr.status, 200);
  (async () => { const rd = sr.body.getReader(), dec = new TextDecoder(); try { for (;;) { const { done, value } = await rd.read(); if (done) break; evs.push(dec.decode(value)); } } catch (e) {} })();
  const until = async f => { for (let i = 0; i < 100 && !f(); i++) await new Promise(ok => setTimeout(ok, 20)); assert.ok(f(), 'événement attendu : ' + evs.join('|')); };
  assert.strictEqual((await call('/api/stream')).status, 401);
  await until(() => evs.join('').includes('event: hello'));
  const np2 = await call('/api/login', null, { name: 'alice', password: 'nouveau1' });
  await act(np2.token, 'post', 'second post'); await until(() => evs.join('').includes('event: update'));
  await call('/api/typing', np2.token, { to: 'bob' }); await until(() => evs.join('').includes('"from":"alice"'));
  // pagination côté serveur + compteur de nouveaux posts
  for (let i = 0; i < 12; i++) await act(np2.token, 'post', 'pagination ' + i);
  const p1 = await call('/api/feed?scope=explore&limit=10', b.token); assert.strictEqual(p1.posts.length, 10); assert.strictEqual(p1.more, true);
  const p2 = await call('/api/feed?scope=explore&limit=10&before=' + p1.posts[9].id, b.token); assert.strictEqual(p2.posts.length, 4); assert.strictEqual(p2.more, false);
  assert.strictEqual((await call('/api/feed?scope=explore&after=' + p1.posts[5].id, b.token)).count, 5);
  assert.strictEqual((await call('/api/feed?scope=feed', b.token)).posts.length, 0); assert.strictEqual((await call('/api/feed?scope=x', b.token)).status, 400);
  // messages non lus : curseur de lecture par interlocuteur
  await act(np2.token, 'send', 'bob', 'ping');
  const view = async () => { const st = (await call('/api/state?v=-1', b.token)).state; return Social.Net({ d: { [Social.KEY]: JSON.stringify(st) }, getItem(k) { return this.d[k]; }, setItem() {} }).unreadDm('bob'); };
  assert.strictEqual((await view()).total, 1); assert.strictEqual((await view()).peers.alice, 1);
  await act(b.token, 'markDmRead', 'alice'); assert.strictEqual((await view()).total, 0);
  ac.abort();
  // e-mail vérifié + mot de passe oublié par lien à usage unique
  const tok = m => /\?(?:reset|verify)=([0-9a-f]{64})/.exec(m.text)[1];
  assert.strictEqual((await call('/api/email', np2.token, { email: 'pas-un-mail' })).status, 400);
  const em = await call('/api/email', np2.token, { email: 'Alice@Example.org' }); assert.strictEqual(em.verified, false); assert.strictEqual(outbox.length, 1);
  await call('/api/forgot', null, { id: 'alice' }); assert.strictEqual(outbox.length, 1, 'e-mail non vérifié : aucune récupération');
  assert.strictEqual((await call('/api/verify-email', null, { token: 'a'.repeat(64) })).status, 400);
  const vt = tok(outbox[0]), ver = await call('/api/verify-email', null, { token: vt }); assert.strictEqual(ver.ok, true);
  assert.strictEqual((await call('/api/verify-email', null, { token: vt })).status, 400, 'lien de confirmation à usage unique');
  const sa = (await call('/api/state?v=-1', np2.token)).state; assert.strictEqual(sa.users.alice.email, 'alice@example.org');
  assert.ok(!JSON.stringify((await call('/api/state?v=-1', b.token)).state).includes('example.org'), 'e-mail privé');
  assert.strictEqual((await call('/api/email', b.token, { email: 'alice@example.org' })).status, 400, 'adresse déjà prise');
  const f1 = (await call('/api/forgot', null, { id: 'alice@example.org' })).ok, f2 = (await call('/api/forgot', null, { id: 'inconnu' })).ok;
  assert.ok(f1 && f2 && outbox.length === 2 && outbox[1].to === 'alice@example.org');
  await call('/api/forgot', null, { id: 'alice' }); const rt = tok(outbox[2]);
  assert.strictEqual((await call('/api/reset', null, { token: tok(outbox[1]), password: 'xxxxxx' })).status, 400, 'ancien lien invalidé');
  assert.strictEqual((await call('/api/reset', null, { token: rt, password: 'abc' })).status, 400);
  const dev = await call('/api/login', null, { name: 'alice', password: 'nouveau1' });
  const rr = await call('/api/reset', null, { token: rt, password: 'reinit99' }); assert.strictEqual(rr.ok, true);
  assert.strictEqual((await call('/api/reset', null, { token: rt, password: 'autre123' })).status, 400, 'lien de réinitialisation à usage unique');
  assert.strictEqual((await call('/api/state?v=-1', dev.token)).status, 401); assert.strictEqual((await call('/api/state?v=-1', np2.token)).status, 401);
  assert.strictEqual((await call('/api/login', null, { name: 'alice', password: 'nouveau1' })).status, 400);
  const np3 = await call('/api/login', null, { name: 'alice', password: 'reinit99' }); assert.ok(np3.token);
  np2.token = np3.token;
  // persistance : redémarrage sur le même fichier
  const raw = fs.readFileSync(dbFile); assert.ok(!raw.includes('secret2') && !raw.includes('nouveau1'));
  await new Promise(ok => server.close(ok));
  const s2 = createServer({ db: dbFile, authPerMin: 1000 }); await new Promise(ok => s2.listen(0, '127.0.0.1', ok));
  const base2 = 'http://127.0.0.1:' + s2.address().port;
  const r = await (await fetch(base2 + '/api/state?v=-1', { headers: { Authorization: 'Bearer ' + b.token } })).json();
  assert.strictEqual(r.me, 'bob'); assert.strictEqual(r.state.posts.length, 14);
  await new Promise(ok => s2.close(ok)); fs.rmSync(dir, { recursive: true });
  console.log('ok serveur');
})().catch(e => { console.error(e); process.exit(1); });
