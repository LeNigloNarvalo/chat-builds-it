// Connexion OAuth (Google / GitHub) : fournisseur factice local, création, liaison, fusion, 2FA et garde-fou anti-verrouillage.
const assert = require('assert'), http = require('http'), os = require('os'), path = require('path'), fs = require('fs');
const { createServer } = require('./server.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cornichon-oa-'));
(async () => {
  // faux fournisseur : le « code » désigne la personne (sub = code)
  const idp = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') { const p = new URLSearchParams(b); if (p.get('client_secret') !== 'sec' || !p.get('code_verifier')) { res.statusCode = 400; return res.end('{}'); } return res.end(JSON.stringify({ access_token: 'tok-' + p.get('code') })); }
      const t = /Bearer tok-(.+)/.exec(req.headers.authorization || ''); if (!t) { res.statusCode = 401; return res.end('{}'); }
      res.end(JSON.stringify({ sub: t[1], id: t[1], email: t[1] + '@example.org', email_verified: true, login: t[1] }));
    });
  });
  await new Promise(ok => idp.listen(0, '127.0.0.1', ok));
  const ib = 'http://127.0.0.1:' + idp.address().port, P = { clientId: 'cid', clientSecret: 'sec', authUrl: ib + '/auth', tokenUrl: ib + '/token', userUrl: ib + '/user' };
  const server = createServer({ spam: false, db: path.join(dir, 't.db'), authPerMin: 1000, publicUrl: 'http://x.test', oauth: { google: P, github: Object.assign({}, P, { emailsUrl: ib + '/none' }) }, mail: () => {} });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (p, tok, data) => { const r = await fetch(base + p, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }); return Object.assign(await r.json(), { status: r.status }); };
  // simule le va-et-vient navigateur : start -> (fournisseur) -> /oauth/callback -> redirection
  const roundtrip = async (start, code) => {
    const u = new URL(start.url); assert.strictEqual(u.origin + u.pathname, ib + '/auth'); assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
    assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://x.test/oauth/callback');
    const r = await fetch(base + '/oauth/callback?code=' + code + '&state=' + u.searchParams.get('state'), { redirect: 'manual' });
    assert.strictEqual(r.status, 302); return new URL(r.headers.get('location'), base);
  };
  const login = async (prov, code) => { const loc = await roundtrip(await call('/api/oauth-start', null, { provider: prov }), code); return loc.searchParams.get('oauth'); };

  assert.ok((await call('/api/oauth-providers')).providers.every(p => p.enabled));
  assert.strictEqual((await call('/api/oauth-start', null, { provider: 'facebook' })).status, 400);
  // nouvelle identité -> création d'un compte sans mot de passe
  const t1 = await login('github', 'zed'); assert.ok(t1);
  const f1 = await call('/api/oauth-finish', null, { ticket: t1 }); assert.ok(f1.pending && f1.suggested === 'zed');
  assert.strictEqual((await call('/api/oauth-complete', null, { ticket: t1, action: 'create', name: 'a!' })).status, 400);
  const z = await call('/api/oauth-complete', null, { ticket: t1, action: 'create', name: 'zed' }); assert.strictEqual(z.name, 'zed'); assert.ok(z.token);
  assert.strictEqual((await call('/api/oauth-finish', null, { ticket: t1 })).status, 400); // billet consommé
  let m = await call('/api/oauth/methods', z.token); assert.strictEqual(m.hasPassword, false); assert.strictEqual(m.methods, 1); assert.strictEqual(m.identities[0].provider, 'github');
  assert.strictEqual((await call('/api/login', null, { name: 'zed', password: 'x'.repeat(48) })).status, 400); // mot de passe aléatoire inconnu
  // reconnexion par la même identité
  const t2 = await login('github', 'zed'), z2 = await call('/api/oauth-finish', null, { ticket: t2 }); assert.strictEqual(z2.name, 'zed'); assert.ok(z2.token && z2.token !== z.token);
  // anti-verrouillage : impossible de délier la seule méthode
  let r = await call('/api/oauth/unlink', z.token, { provider: 'github' }); assert.strictEqual(r.status, 400); assert.match(r.error, /dernier moyen/);
  // choisir un mot de passe, lier Google, puis délier GitHub
  r = await call('/api/oauth/set-password', z.token, { password: 'abcd' }); assert.ok(r.token && r.state.hasPassword); const tok = r.token;
  assert.strictEqual((await call('/api/state?v=-1', z.token)).status, 401); // l'ancienne session est fermée
  assert.strictEqual((await call('/api/oauth/set-password', tok, { password: 'abcdef' })).status, 400);
  const lk = await roundtrip(await call('/api/oauth/link', tok, { provider: 'google' }), 'zed-g'); assert.strictEqual(lk.searchParams.get('oauth_linked'), 'google');
  m = await call('/api/oauth/methods', tok); assert.strictEqual(m.identities.length, 2); assert.strictEqual(m.methods, 3);
  assert.strictEqual((await call('/api/oauth/link', tok, { provider: 'google' })).status, 200); // relier : refusé au retour (déjà lié)
  m = await call('/api/oauth/unlink', tok, { provider: 'github' }); assert.strictEqual(m.identities.length, 1);
  assert.strictEqual((await call('/api/oauth/unlink', tok, { provider: 'github' })).status, 400);
  // une identité ne peut pas servir deux comptes
  const bob = await call('/api/signup', null, { name: 'bob', password: 'secret2' });
  const dup = await roundtrip(await call('/api/oauth/link', bob.token, { provider: 'google' }), 'zed-g'); assert.match(dup.searchParams.get('oauth_error'), /déjà lié/);
  // fusion : identité inconnue rattachée à un compte existant (mot de passe exigé)
  const t3 = await login('google', 'bobby'); assert.ok((await call('/api/oauth-finish', null, { ticket: t3 })).pending);
  assert.strictEqual((await call('/api/oauth-complete', null, { ticket: t3, action: 'link', name: 'bob', password: 'faux' })).status, 400);
  const bl = await call('/api/oauth-complete', null, { ticket: t3, action: 'link', name: 'bob', password: 'secret2' }); assert.strictEqual(bl.name, 'bob');
  const t4 = await login('google', 'bobby'); assert.strictEqual((await call('/api/oauth-finish', null, { ticket: t4 })).name, 'bob');
  // clés d'accès comptées dans le garde-fou : mot de passe + 1 identité -> on peut délier, puis plus rien à retirer côté identité
  assert.strictEqual((await call('/api/oauth/unlink', bob.token, { provider: 'google' })).identities.length, 0);
  // état falsifié ou rejoué
  const rep = await fetch(base + '/oauth/callback?code=x&state=nope', { redirect: 'manual' }); assert.match(rep.headers.get('location'), /oauth_error/);
  server.close(); idp.close(); console.log('test-oauth ok');
})().catch(e => { console.error(e); process.exit(1); });
