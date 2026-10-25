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
  // recherche paginée (récent + populaire), messages et conversations par curseur
  const sr1 = await call('/api/feed?scope=search&q=pagination&limit=5', b.token); assert.strictEqual(sr1.ids.length, 5); assert.strictEqual(sr1.more, true); assert.strictEqual(sr1.total, 12);
  const sr2 = await call('/api/feed?scope=search&q=pagination&limit=5&before=' + sr1.ids[4], b.token); assert.strictEqual(sr2.ids.length, 5); assert.ok(sr2.ids[0] < sr1.ids[4]);
  const sr3 = await call('/api/feed?scope=search&q=pagination&limit=5&before=' + sr2.ids[4], b.token); assert.strictEqual(sr3.ids.length, 2); assert.strictEqual(sr3.more, false);
  assert.strictEqual((await call('/api/feed?scope=search&q=pagination&after=' + sr1.ids[2], b.token)).count, 2);
  const sp1 = await call('/api/feed?scope=search&q=pagination&sort=popular&limit=5', b.token), sp2 = await call('/api/feed?scope=search&q=pagination&sort=popular&limit=20&before=' + sp1.ids[4], b.token);
  assert.strictEqual(new Set([...sp1.ids, ...sp2.ids]).size, 12, 'tri populaire : pas de doublon ni de trou');
  // messages non lus : curseur de lecture par interlocuteur
  await act(np2.token, 'send', 'bob', 'ping');
  const view = async () => { const st = (await call('/api/state?v=-1', b.token)).state; return Social.Net({ d: { [Social.KEY]: JSON.stringify(st) }, getItem(k) { return this.d[k]; }, setItem() {} }).unreadDm('bob'); };
  assert.strictEqual((await view()).total, 1); assert.strictEqual((await view()).peers.alice, 1);
  await act(b.token, 'markDmRead', 'alice'); assert.strictEqual((await view()).total, 0);
  for (let i = 0; i < 7; i++) await act(np2.token, 'send', 'bob', 'msg ' + i);
  const dd1 = await call('/api/feed?scope=dm&peer=alice&limit=3', b.token); assert.strictEqual(dd1.ids.length, 3); assert.strictEqual(dd1.more, true);
  const dd2 = await call('/api/feed?scope=dm&peer=alice&limit=50&before=' + dd1.ids[2], b.token); assert.strictEqual(dd2.more, false); assert.ok(dd2.ids.every(i => i < dd1.ids[2]));
  assert.strictEqual((await call('/api/feed?scope=convs&limit=10', b.token)).ids.length, 1);
  const nn1 = await call('/api/feed?scope=notifs&limit=2', b.token); assert.ok(Array.isArray(nn1.ids) && nn1.total >= nn1.ids.length && typeof nn1.more === "boolean");
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
  // brouillons privés + publication planifiée par l'horloge du serveur
  const at = Date.now() + 1200;
  const dr = await act(np2.token, 'saveDraft', null, 'programmé !', [], { scheduledAt: at }); assert.ok(dr.result.id);
  assert.strictEqual((await call('/api/state?v=-1', b.token)).state.drafts.length, 0);
  assert.strictEqual((await call('/api/state?v=-1', np2.token)).state.drafts.length, 1);
  await new Promise(ok => setTimeout(ok, 1500));
  s = await call('/api/state?v=-1', np2.token); assert.strictEqual(s.state.drafts.length, 0); assert.ok(s.state.posts.some(x => x.text === 'programmé !'));
  assert.strictEqual((await act(np2.token, 'publishDue')).status, 400);
  // pages publiques + flux RSS/Atom, sans compte
  const raw0 = async p => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  const pp = await act(a1.token, 'post', '<b>Salut</b> #Cornichon public'); const pid = pp.result.id;
  let pg = await raw0('/p/' + pid); assert.strictEqual(pg.status, 200);
  assert.ok(pg.text.includes('property="og:title"') && pg.text.includes('property="og:description"') && !pg.text.includes('<b>Salut</b>') && pg.text.includes('&lt;b&gt;Salut'));
  pg = await raw0('/u/ALICE'); assert.ok(pg.status === 200 && pg.text.includes('application/rss+xml') && pg.text.includes('/tag/cornichon'));
  let fd = await raw0('/u/alice/feed.xml'); assert.ok(/rss/.test(fd.type) && fd.text.includes('<item>') && fd.text.includes('/p/' + pid));
  fd = await raw0('/tag/cornichon/atom.xml'); assert.ok(/atom/.test(fd.type) && fd.text.includes('<entry>') && fd.text.includes('/p/' + pid));
  assert.ok((await raw0('/tag/cornichon')).text.includes('og:title'));
  assert.strictEqual((await raw0('/p/99999')).status, 404); assert.strictEqual((await raw0('/u/personne')).status, 404); assert.strictEqual((await raw0('/p/abc')).status, 404);
  assert.ok((await raw0('/public')).text.includes('/p/' + pid)); assert.ok((await raw0('/public/feed.xml')).text.includes('<rss'));
  // persistance : redémarrage sur le même fichier
  const raw = fs.readFileSync(dbFile); assert.ok(!raw.includes('secret2') && !raw.includes('nouveau1'));
  await new Promise(ok => server.close(ok));
  const s2 = createServer({ db: dbFile, authPerMin: 1000 }); await new Promise(ok => s2.listen(0, '127.0.0.1', ok));
  const base2 = 'http://127.0.0.1:' + s2.address().port;
  const r = await (await fetch(base2 + '/api/state?v=-1', { headers: { Authorization: 'Bearer ' + b.token } })).json();
  assert.strictEqual(r.me, 'bob'); assert.strictEqual(r.state.posts.length, 15);
  await new Promise(ok => s2.close(ok)); fs.rmSync(dir, { recursive: true });
  console.log('ok serveur');
})().catch(e => { console.error(e); process.exit(1); });
(async () => {
  const s2 = createServer({ db: path.join(dir, 'p.db') }); await new Promise(ok => s2.listen(0, '127.0.0.1', ok));
  const b2 = 'http://127.0.0.1:' + s2.address().port;
  for (const [f, t] of [['sw.js', 'javascript'], ['manifest.webmanifest', 'manifest+json'], ['icon.svg', 'svg'], ['notif.js', 'javascript']]) { const r = await fetch(b2 + '/' + f); assert.strictEqual(r.status, 200, f); assert.ok(r.headers.get('content-type').includes(t), f); }
  s2.close(); console.log('ok fichiers PWA');
})().catch(e => { console.error(e); process.exit(1); });
// jetons d'API + webhooks : vrai récepteur HTTP local, signature, journal, révocation
(async () => {
  const crypto = require('crypto'), http = require('http');
  const got = []; let status = 200;
  const rcv = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { got.push({ h: q.headers, b }); r.writeHead(status); r.end('reçu'); }); });
  await new Promise(ok => rcv.listen(0, '127.0.0.1', ok));
  const hook = 'http://127.0.0.1:' + rcv.address().port + '/h';
  const srv = createServer({ db: ':memory:', authPerMin: 1000, webhookPrivate: true }); await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (p, tok, data) => { const r = await fetch(base + p, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: data === undefined ? undefined : JSON.stringify(data) }); return Object.assign(await r.json(), { status: r.status }); };
  const open = async (name) => (await (await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password: 'secret1' }) })).json()).token;
  const wait = async f => { for (let i = 0; i < 50 && !f(); i++) await new Promise(ok => setTimeout(ok, 50)); };
  const al = await open('alice'), bo = await open('bobby');
  // jetons : validation, affichage unique, permissions
  assert.strictEqual((await call('/api/dev/token', al, { label: '', scopes: ['read'] })).status, 400);
  assert.strictEqual((await call('/api/dev/token', al, { label: 'x', scopes: ['admin'] })).status, 400);
  const ro = await call('/api/dev/token', al, { label: 'lecture', scopes: ['read'] }), rw = await call('/api/dev/token', al, { label: 'bot', scopes: ['read', 'write'] });
  assert.ok(/^cnch_[0-9a-f]{40}$/.test(ro.token));
  const list = await call('/api/dev', al); assert.strictEqual(list.tokens.length, 2); assert.ok(!JSON.stringify(list).includes(ro.token), 'le jeton complet n\'est plus jamais renvoyé');
  assert.strictEqual((await call('/api/dev', bo)).tokens.length, 0);
  assert.strictEqual((await call('/api/v1/me', ro.token)).name, 'alice');
  assert.strictEqual((await call('/api/v1/posts', ro.token, { text: 'non' })).status, 403, 'jeton en lecture seule');
  const pp = await call('/api/v1/posts', rw.token, { text: 'publié par jeton' }); assert.strictEqual(pp.author, 'alice');
  assert.strictEqual((await call('/api/state?v=-1', rw.token)).status, 403, 'un jeton n\'ouvre que /api/v1');
  assert.strictEqual((await call('/api/dev', rw.token)).status, 403);
  assert.strictEqual((await call('/api/v1/me', 'cnch_' + '0'.repeat(40))).status, 401);
  // webhooks : URL, événements, SSRF par défaut
  assert.strictEqual((await call('/api/dev/hook', al, { url: 'ftp://x', events: ['mention'] })).status, 400);
  assert.strictEqual((await call('/api/dev/hook', al, { url: hook, events: [] })).status, 400);
  const h = await call('/api/dev/hook', al, { url: hook, events: ['mention', 'follow'] }); assert.ok(h.id);
  const hs = (await call('/api/dev', al)).hooks[0]; assert.ok(/^whsec_/.test(hs.secret));
  // test + signature
  const t = await call('/api/dev/hook-test', al, { id: h.id, event: 'ping' }); assert.strictEqual(t.ok, true); assert.strictEqual(t.code, 200);
  const sig = crypto.createHmac('sha256', hs.secret).update(got[0].b).digest('hex');
  assert.strictEqual(got[0].h['x-cornichon-signature'], 'sha256=' + sig); assert.strictEqual(JSON.parse(got[0].b).test, true);
  // évènements réels : mention puis abonné
  await act2(bo, 'post', 'salut @alice !');
  async function act2(tok, method, ...args) { return call('/api/call', tok, { method, args }); }
  await wait(() => got.length >= 2); assert.strictEqual(JSON.parse(got[1].b).event, 'mention'); assert.strictEqual(JSON.parse(got[1].b).data.from, 'bobby'); assert.ok(JSON.parse(got[1].b).data.post.text.includes('@alice'));
  await act2(bo, 'toggleFollow', 'alice');
  await wait(() => got.length >= 3); assert.strictEqual(JSON.parse(got[2].b).event, 'follow');
  assert.strictEqual((await call('/api/v1/mentions', ro.token)).mentions.length, 1);
  assert.deepStrictEqual((await call('/api/v1/followers', ro.token)).followers, ['bobby']);
  // journal + échec + renvoi
  let lg = (await call('/api/dev', al)).log; assert.strictEqual(lg.length, 3); assert.ok(lg.every(x => x.ok));
  assert.ok((await call('/api/dev/delivery?id=' + lg[0].id, al)).payload.includes('follow'));
  assert.strictEqual((await call('/api/dev/delivery?id=' + lg[0].id, bo)).status, 400, 'journal privé');
  status = 500; const bad = await call('/api/dev/redeliver', al, { id: lg[0].id }); assert.strictEqual(bad.ok, false); assert.strictEqual(bad.code, 500);
  status = 200;
  // pause : plus d'envoi ; suppression
  await call('/api/dev/hook-update', al, { id: h.id, active: false }); const n = got.length; await act2(bo, 'post', 'encore @alice'); await new Promise(ok => setTimeout(ok, 300)); assert.strictEqual(got.length, n);
  assert.strictEqual((await call('/api/dev/hook-delete', bo, { id: h.id })).status, 400, 'pas le webhook d\'autrui');
  // révocation
  await call('/api/dev/token-revoke', al, { id: rw.id }); assert.strictEqual((await call('/api/v1/me', rw.token)).status, 401);
  assert.strictEqual((await call('/api/v1/me', ro.token)).status, 200);
  // adresses internes refusées par défaut
  const s3 = createServer({ db: ':memory:' }); await new Promise(ok => s3.listen(0, '127.0.0.1', ok));
  const b3 = 'http://127.0.0.1:' + s3.address().port, tk = (await (await fetch(b3 + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'carol', password: 'secret1' }) })).json()).token;
  const r3 = await fetch(b3 + '/api/dev/hook', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ url: 'http://127.0.0.1:9/x', events: ['follow'] }) }); assert.strictEqual(r3.status, 400);
  // double authentification (TOTP) : activation, connexion avec code, secours, appareils de confiance
  {
    const T = require('./totp.js'), tc = (p, tok, d, h) => fetch(base + p, { method: d === undefined ? 'GET' : 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}, h || {}), body: d === undefined ? undefined : JSON.stringify(d) }).then(async r => Object.assign(await r.json(), { status: r.status }));
    assert.strictEqual(T.code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082', 'vecteur RFC 6238'); // secret "12345678901234567890", t=59 s
    const u = await tc('/api/signup', null, { name: 'totpy', password: 'secret1' }), tk = u.token;
    const su = await tc('/api/2fa/setup', tk, {}); assert.ok(/^[A-Z2-7]{32}$/.test(su.secret) && su.uri.startsWith('otpauth://totp/Cornichon:totpy?secret=' + su.secret));
    assert.strictEqual((await tc('/api/2fa/enable', tk, { code: '000000' })).status, 400);
    assert.strictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1' })).token.length, 64, 'sans 2FA : connexion directe');
    const en = await tc('/api/2fa/enable', tk, { code: T.code(su.secret), trust: true }); assert.strictEqual(en.codes.length, 10); assert.ok(en.trusted);
    assert.strictEqual((await tc('/api/2fa/setup', tk, {})).status, 400, 'déjà active');
    // mot de passe seul : refusé ; mauvais code : refusé ; bon code : session
    assert.deepStrictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1' })).mfa, true);
    assert.strictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1', code: '123456' })).status, 400);
    // anti-rejeu : le code déjà utilisé à l'activation ne sert plus ; on avance d'un pas avec le code suivant
    const prev = T.code(su.secret, Date.now() - 30000), nxt = T.code(su.secret, Date.now() + 30000);
    assert.strictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1', code: T.code(su.secret) })).status, 400, 'rejeu refusé');
    const ok = await tc('/api/login', null, { name: 'totpy', password: 'secret1', code: nxt, trust: false }); assert.strictEqual(ok.token.length, 64); assert.ok(!ok.trusted);
    void prev;
    // appareil de confiance : plus de code demandé ; retiré : le code redevient nécessaire
    assert.strictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1', trusted: en.trusted })).token.length, 64);
    let st = await tc('/api/2fa', tk); assert.strictEqual(st.enabled, true); assert.strictEqual(st.backupLeft, 10); assert.strictEqual(st.devices.length, 1);
    assert.ok(!JSON.stringify(st).includes(su.secret), 'secret non renvoyé après activation');
    // codes de secours : à usage unique
    const bc = en.codes[0];
    const viaBackup = await tc('/api/login', null, { name: 'totpy', password: 'secret1', code: bc.toUpperCase(), trust: true }); assert.strictEqual(viaBackup.token.length, 64); assert.ok(viaBackup.trusted);
    assert.strictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1', code: bc })).status, 400, 'code de secours déjà utilisé');
    st = await tc('/api/2fa', tk); assert.strictEqual(st.backupLeft, 9); assert.strictEqual(st.devices.length, 2);
    await tc('/api/2fa/device-revoke', tk, { id: st.devices[0].id }); await tc('/api/2fa/device-revoke', tk, { id: st.devices[1].id });
    assert.deepStrictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1', trusted: en.trusted })).mfa, true);
    // désactivation : mot de passe + code
    assert.strictEqual((await tc('/api/2fa/disable', tk, { password: 'faux', code: en.codes[1] })).status, 400);
    const rg = await tc('/api/2fa/backup', tk, { password: 'secret1', code: en.codes[1] }); assert.strictEqual(rg.codes.length, 10);
    assert.strictEqual((await tc('/api/2fa/disable', tk, { password: 'secret1', code: en.codes[2] })).status, 400, 'anciens codes invalidés');
    assert.strictEqual((await tc('/api/2fa/disable', tk, { password: 'secret1', code: rg.codes[0] })).ok, true);
    assert.strictEqual((await tc('/api/login', null, { name: 'totpy', password: 'secret1' })).token.length, 64);
    assert.strictEqual((await tc('/api/2fa')).status, 401);
  }
  // statistiques personnelles : vues (pas celles de l'auteur, dédupliquées), réactions, réponses, abonnés, classement, heures
  {
    const act = (tok, method, ...args) => call('/api/call', tok, { method, args }).then(r => r), sa = { token: await open('statsa') }, sb = { token: await open('statsb') };
    const p1 = (await act(sa.token, 'post', 'premier')).result, p2 = (await act(sa.token, 'post', 'second')).result;
    assert.strictEqual((await call('/api/view', sa.token, { ids: [p1.id] })).n, 0, 'pas de vue sur ses propres posts');
    assert.strictEqual((await call('/api/view', sb.token, { ids: [p1.id, p1.id, p2.id, 99999] })).n, 2, 'une vue par post et par lecteur');
    assert.strictEqual((await call('/api/view', sb.token, { ids: [p1.id] })).n, 0, 'dédupliqué sur l\'heure');
    await act(sb.token, 'toggleLike', p1.id); await act(sb.token, 'post', 'une réponse', p1.id); await act(sb.token, 'toggleFollow', 'statsa');
    const r = await call('/api/stats?days=7&tz=0', sa.token);
    assert.deepStrictEqual(r.totals, { views: 2, reactions: 1, replies: 1, followers: 1 });
    assert.strictEqual(r.series.length, 7); assert.strictEqual(r.series[6].views, 2); assert.strictEqual(r.hours.length, 24);
    assert.strictEqual(r.top[0].id, p1.id); assert.strictEqual(r.top[0].views, 1); assert.strictEqual(r.top[0].reactions, 1);
    assert.strictEqual((await call('/api/stats?days=7', sb.token)).totals.views, 0, 'chacun ne voit que ses statistiques');
    assert.strictEqual((await call('/api/stats')).status, 401);
  }
  // sauvegardes : réservées à l'admin, restauration fidèle (même vers une version plus ancienne), rotation
  {
    const bsrv = createServer({ db: path.join(dir, 'bk.db'), authPerMin: 1000 }); await new Promise(ok => bsrv.listen(0, '127.0.0.1', ok));
    const base = 'http://127.0.0.1:' + bsrv.address().port;
    const call = async (p, tok, data) => { const r = await fetch(base + p, { method: data === undefined ? 'GET' : 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: data === undefined ? undefined : JSON.stringify(data) }); return Object.assign(await r.json(), { status: r.status }); };
    const open = async name => (await call('/api/signup', null, { name, password: 'secret1' })).token;
    const adm = await call('/api/stream-session', null, {}), user = { token: await open('bkuser') }, A = adm.token;
    assert.strictEqual((await call('/api/admin/backups', user.token)).status, 403); assert.strictEqual((await call('/api/admin/backups')).status, 401);
    let st = await call('/api/admin/backups', A); assert.ok(st.backups.length >= 1 && st.backups[0].kind === 'auto', 'sauvegarde quotidienne au démarrage');
    const act = (tok, method, ...args) => call('/api/call', tok, { method, args });
    await act(user.token, 'post', 'avant la sauvegarde');
    st = await call('/api/admin/backups/create', A, {}); const snap = st.backups.find(b => b.kind === 'manual'); assert.ok(snap);
    await act(user.token, 'post', 'après la sauvegarde');
    assert.strictEqual((await call('/api/state?v=-1', user.token)).state.posts.filter(p => /sauvegarde/.test(p.text)).length, 2);
    assert.strictEqual((await call('/api/admin/backups/restore', A, { id: snap.id })).status, 400, 'confirmation requise');
    assert.strictEqual((await call('/api/admin/backups/restore', A, { id: '../x.db', confirm: true })).status, 400);
    const v0 = (await call('/api/state?v=-1', user.token)).version;
    const rs = await call('/api/admin/backups/restore', A, { id: snap.id, confirm: true }); assert.ok(rs.safety && rs.backups.some(b => b.kind === 'pre'));
    const after = await call('/api/state?v=' + v0, user.token); assert.ok(!after.unchanged && after.version > v0, 'les clients rapatrient la vue restaurée');
    assert.deepStrictEqual(after.state.posts.filter(p => /sauvegarde/.test(p.text)).map(p => p.text), ['avant la sauvegarde']);
    assert.strictEqual((await call('/api/state?v=-1', user.token)).me, 'bkuser', 'les sessions survivent à la restauration');
    const dl = await fetch(base + '/api/admin/backups/' + snap.id + '/download', { headers: { Authorization: 'Bearer ' + A } }); assert.strictEqual(dl.status, 200);
    assert.strictEqual(Buffer.from(await dl.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
    assert.strictEqual((await call('/api/admin/backups/' + snap.id + '/download', user.token)).status, 403);
    assert.strictEqual((await call('/api/admin/backups/delete', A, { id: snap.id })).backups.some(b => b.id === snap.id), false);
    // rotation : seules les sauvegardes automatiques excédentaires disparaissent
    const { Backups } = require('./backup.js'), { DatabaseSync } = require('node:sqlite'), bdir = path.join(dir, 'rot'), tdb = new DatabaseSync(':memory:');
    tdb.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, version INTEGER)'); const B = Backups(tdb, bdir, { keep: 2 });
    for (let i = 0; i < 4; i++) B.create('auto'); B.create('manual');
    assert.strictEqual(B.list().filter(b => b.kind === 'auto').length, 2); assert.strictEqual(B.list().filter(b => b.kind === 'manual').length, 1);
    assert.strictEqual(B.daily(), null, 'pas de 2e sauvegarde quotidienne le même jour'); B.setKeep(1); assert.strictEqual(B.list().filter(b => b.kind === 'auto').length, 1);
    fs.writeFileSync(path.join(bdir, 'cornichon-20200101-000000-000-auto.db'), 'pas une base'); assert.throws(() => B.restore('cornichon-20200101-000000-000-auto.db'), /invalide|corrompue/);
    tdb.close(); bsrv.close();
  }
  // sessions actives et journal de sécurité : liste, révocation ciblée, tentatives ratées, mot de passe
  {
    const ssrv = createServer({ db: path.join(dir, 'ses.db'), authPerMin: 1000 }); await new Promise(ok => ssrv.listen(0, '127.0.0.1', ok));
    const base = 'http://127.0.0.1:' + ssrv.address().port;
    const call = async (p, tok, data, ua) => { const r = await fetch(base + p, { method: data === undefined ? 'GET' : 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, ua ? { 'User-Agent': ua } : {}, ua === 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120' ? { 'X-Timezone': 'Europe/Paris' } : {}, tok ? { Authorization: 'Bearer ' + tok } : {}), body: data === undefined ? undefined : JSON.stringify(data) }); return Object.assign(await r.json(), { status: r.status }); };
    const FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0', ED = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120';
    const a = await call('/api/signup', null, { name: 'sesuser', password: 'secret1' }, FF);
    await call('/api/login', null, { name: 'sesuser', password: 'faux' }, ED);
    const b = await call('/api/login', null, { name: 'sesuser', password: 'secret1' }, ED);
    let r = await call('/api/sessions', a.token); assert.strictEqual(r.sessions.length, 2);
    assert.ok(r.sessions.find(x => x.current).label === 'Firefox · Linux' && r.sessions.some(x => x.label === 'Edge · Windows'));
    assert.deepStrictEqual(r.log.map(x => x.kind), ['login', 'login_fail', 'signup']);
    assert.strictEqual(r.sessions.find(x => !x.current).place, 'Paris (Europe)', 'lieu approximatif déduit du fuseau'); assert.strictEqual(r.log[0].place, 'Paris (Europe)'); assert.strictEqual(r.sessions.find(x => x.current).place, '');
    assert.strictEqual((await call('/api/sessions')).status, 401);
    const other = await call('/api/sessions', b.token), ob = r.sessions.find(x => !x.current);
    assert.strictEqual((await call('/api/session-revoke', a.token, { id: r.sessions.find(x => x.current).id })).status, 400, 'pas sa propre session');
    const stranger = await call('/api/signup', null, { name: 'sesother', password: 'secret1' });
    assert.strictEqual((await call('/api/session-revoke', stranger.token, { id: ob.id })).status, 404, 'pas la session d\'un autre');
    assert.strictEqual((await call('/api/session-revoke', a.token, { id: ob.id })).ok, true);
    assert.strictEqual((await call('/api/sessions', b.token)).status, 401, 'l\'appareil révoqué est déconnecté'); assert.ok(other.sessions.length === 2);
    const c = await call('/api/login', null, { name: 'sesuser', password: 'secret1' }, ED);
    assert.strictEqual((await call('/api/sessions-revoke', a.token, {})).ok, true);
    assert.strictEqual((await call('/api/sessions', c.token)).status, 401); r = await call('/api/sessions', a.token); assert.strictEqual(r.sessions.length, 1);
    const pw = await call('/api/password', a.token, { oldPw: 'secret1', newPw: 'secret2' }, FF);
    r = await call('/api/sessions', pw.token); assert.strictEqual(r.log[0].kind, 'password_change'); assert.strictEqual(r.sessions.length, 1);
    assert.strictEqual((await call('/api/sessions', stranger.token)).log.length, 1, 'chacun ne voit que son journal');
    ssrv.close();
  }
  for (const x of [s3, srv, rcv]) x.close(); rcv.closeAllConnections && rcv.closeAllConnections();
  console.log('ok jetons, webhooks, double authentification, statistiques & sauvegardes'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
