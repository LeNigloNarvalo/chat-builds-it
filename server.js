// Serveur Cornichon : petite API Node + SQLite (node:sqlite, aucune dépendance).
// Le moteur social.js tourne ICI ; les navigateurs ne reçoivent qu'une vue filtrée de leur compte (jamais de mots de passe)
// et envoient leurs actions à /api/call, authentifiées par une session aléatoire (seul son hachage SHA-256 est stocké).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Social = require('./social.js');

const SESSION_MS = 30 * 86400000, MAX_SESSIONS = 20, MAX_BODY = 10 * 1024 * 1024;
// actions qui modifient les données : le 1er argument (l'utilisateur) est TOUJOURS remplacé par le titulaire de la session
const ACTIONS = new Set(['post', 'deletePost', 'editPost', 'toggleBookmark', 'toggleRepost', 'toggleLike', 'toggleFollow', 'updateProfile', 'importUser', 'send', 'toggleBlock', 'toggleMute', 'report', 'moderate', 'liftSanction', 'exportUser']);
const STATIC = new Set(['index.html', 'style.css', 'a11y.js', 'theme.js', 'social.js', 'sync.js', 'app.js']);
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function createServer(opts = {}) {
  const dir = opts.dir || __dirname;
  const dbFile = opts.db || process.env.CORNICHON_DB || path.join(__dirname, 'data', 'cornichon.db');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, name TEXT NOT NULL, epoch INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  const getRow = db.prepare('SELECT v, version FROM kv WHERE k = ?'), putRow = db.prepare(`INSERT INTO kv (k, v, version) VALUES (?, ?, 1)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v, version = version + 1`);
  const storage = { getItem: k => { const r = getRow.get(k); return r ? r.v : null; }, setItem: (k, v) => { putRow.run(k, String(v)); } };
  const version = () => (getRow.get(Social.KEY) || { version: 0 }).version;
  const net = Social.Net(storage);

  // ---- sessions ----
  const insS = db.prepare('INSERT INTO sessions (hash, name, epoch, created, expires) VALUES (?, ?, ?, ?, ?)'), getS = db.prepare('SELECT * FROM sessions WHERE hash = ?'),
    delS = db.prepare('DELETE FROM sessions WHERE hash = ?'), delUser = db.prepare('DELETE FROM sessions WHERE name = ?'),
    trimS = db.prepare('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE name = ? ORDER BY created DESC LIMIT -1 OFFSET ?)'), purge = db.prepare('DELETE FROM sessions WHERE expires < ?');
  const openSession = name => {
    const token = crypto.randomBytes(32).toString('hex'), now = Date.now();
    purge.run(now); insS.run(sha(token), name, net.epoch(name), now, now + SESSION_MS); trimS.run(name, MAX_SESSIONS);
    return { name, token };
  };
  function auth(req) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || ''); if (!m) return null;
    const s = getS.get(sha(m[1])); if (!s || s.expires < Date.now()) return null;
    try { if (net.epoch(s.name) !== s.epoch) { delS.run(s.hash); return null; } } catch (e) { delS.run(s.hash); return null; }
    return { name: net.profile(s.name).name, hash: s.hash };
  }

  // ---- limite de débit par IP sur les routes d'authentification ----
  const hits = new Map();
  const limited = req => {
    const ip = req.socket.remoteAddress, now = Date.now(); let h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, h = { n: 0, reset: now + 60000 });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return ++h.n > (opts.authPerMin || 30);
  };
  const loopback = req => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];

  const HEAD = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" };
  const send = (res, code, obj) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, HEAD)); res.end(JSON.stringify(obj)); };
  class Http extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const body = req => new Promise((ok, ko) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { ko(new Http(413, 'Requête trop volumineuse')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { const o = JSON.parse(Buffer.concat(parts).toString() || '{}'); ok(o && typeof o === 'object' && !Array.isArray(o) ? o : {}); } catch (e) { ko(new Http(400, 'JSON invalide')); } });
    req.on('error', ko);
  });

  async function api(req, res, url) {
    const route = req.method + ' ' + url.pathname;
    if (route === 'GET /api/health') return send(res, 200, { ok: true });
    if (/^POST \/api\/(signup|login|stream-session)$/.test(route) && limited(req)) throw new Http(429, 'Trop de requêtes : réessayez dans une minute');
    if (route === 'POST /api/signup') { const b = await body(req); const name = await net.signup(b.name, b.password, b.bio); return send(res, 200, openSession(name)); }
    if (route === 'POST /api/login') { const b = await body(req); const name = await net.login(String(b.name || ''), String(b.password || '')); return send(res, 200, openSession(name)); }
    // vue du stream : ouvre le vrai compte « Streamer » SANS mot de passe, uniquement depuis la machine du serveur
    if (route === 'POST /api/stream-session') {
      if (!loopback(req)) throw new Http(403, 'Réservé à la machine du stream');
      return send(res, 200, openSession(await net.ensureStreamer()));
    }
    const me = auth(req); if (!me) throw new Http(401, 'Session expirée : reconnectez-vous');
    if (route === 'GET /api/state') {
      const v = version();
      if (+url.searchParams.get('v') === v) return send(res, 200, { unchanged: true, version: v, me: me.name });
      return send(res, 200, { version: v, me: me.name, state: Social.snapshot(net.db(), me.name) });
    }
    if (route === 'POST /api/logout') { delS.run(me.hash); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/logout-all') { net.logoutAll(me.name); delUser.run(me.name); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/password') {
      const b = await body(req); await net.changePassword(me.name, String(b.oldPw || ''), String(b.newPw || ''));
      delUser.run(me.name); return send(res, 200, openSession(me.name)); // les autres appareils sont déconnectés
    }
    if (route === 'POST /api/delete-account') { const b = await body(req); await net.deleteAccount(me.name, String(b.password || '')); delUser.run(me.name); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/read-notifications') { net.notifications(me.name, true); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/call') {
      const b = await body(req);
      if (!ACTIONS.has(b.method) || !Array.isArray(b.args) || b.args.length > 5) throw new Http(400, 'Action inconnue');
      const result = await net[b.method](me.name, ...b.args);
      return send(res, 200, { result: result === undefined ? null : result });
    }
    throw new Http(404, 'Route inconnue');
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (req.method !== 'GET' || !STATIC.has(file)) throw new Http(404, 'Introuvable');
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES[file.split('.').pop()], 'Cache-Control': 'no-cache' }, HEAD));
      res.end(fs.readFileSync(path.join(dir, file)));
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.code === undefined && e.constructor !== Error) console.error('Erreur interne :', e);
      // messages de l'application (Error simples) renvoyés tels quels ; erreurs internes jamais détaillées
      send(res, e.code >= 400 ? e.code : e.constructor === Error ? 400 : 500, { error: e.code >= 400 || e.constructor === Error ? e.message : 'Erreur interne du serveur : réessayez dans un instant' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

module.exports = { createServer };
if (require.main === module) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  // une erreur inattendue ne doit pas faire tomber tout le serveur (sinon : « Erreur du serveur » partout)
  process.on('uncaughtException', e => console.error('Exception non gérée :', e));
  process.on('unhandledRejection', e => console.error('Promesse rejetée :', e));
  const port = +process.env.PORT || 8080;
  createServer().listen(port, process.env.HOST || '0.0.0.0', () => console.log(`🥒 Cornichon sur http://localhost:${port}`));
}
