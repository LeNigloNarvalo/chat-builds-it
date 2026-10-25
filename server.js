// Serveur Cornichon : petite API Node + SQLite (node:sqlite, aucune dépendance).
// Le moteur social.js tourne ICI ; les navigateurs ne reçoivent qu'une vue filtrée de leur compte (jamais de mots de passe)
// et envoient leurs actions à /api/call, authentifiées par une session aléatoire (seul son hachage SHA-256 est stocké).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const Social = require('./social.js'), Stats = require('./stats.js'), { Dev } = require('./devapi.js'), { Totp, deviceLabel } = require('./totp.js'), { Backups } = require('./backup.js'), { Public } = require('./public.js');

const SESSION_MS = 30 * 86400000, MAX_SESSIONS = 20, MAX_BODY = 10 * 1024 * 1024;
// actions qui modifient les données : le 1er argument (l'utilisateur) est TOUJOURS remplacé par le titulaire de la session
const ACTIONS = new Set(['post', 'deletePost', 'editPost', 'toggleBookmark', 'toggleTopic', 'toggleRepost', 'toggleLike', 'react', 'quote', 'toggleFollow', 'updateProfile', 'setOnboarding', 'importUser', 'send', 'toggleBlock', 'toggleMute', 'report', 'moderate', 'liftSanction', 'appeal', 'decideAppeal', 'adminSanction', 'adminDeleteUser', 'exportUser', 'markDmRead', 'deleteConversation', 'saveDraft', 'deleteDraft', 'publishDraft', 'createList', 'updateList', 'deleteList', 'toggleListMember', 'saveSharedList', 'forgetSharedList', 'dismissSuggestion', 'saveSearch', 'deleteSearch', 'markSearchSeen', 'checkSearches', 'setNotifPrefs', 'setPrivacy', 'requestDeletion', 'cancelDeletion', 'vote', 'createGroup', 'updateGroup', 'deleteGroup', 'joinGroup', 'leaveGroup', 'handleRequest', 'inviteToGroup', 'respondInvite', 'cancelInvite', 'removeFromGroup', 'unbanFromGroup', 'setGroupMod']);
const STATIC = new Set(['index.html', 'style.css', 'a11y.js', 'theme.js', 'social.js', 'sync.js', 'diag.js', 'app.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'notif.js', 'qrcode.js', 'stats.js']);
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', webmanifest: 'application/manifest+json; charset=utf-8', svg: 'image/svg+xml' };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function createServer(opts = {}) {
  const dir = opts.dir || __dirname;
  const dbFile = opts.db || process.env.CORNICHON_DB || path.join(__dirname, 'data', 'cornichon.db');
  if (dbFile !== ':memory:') fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS views (post INTEGER NOT NULL, viewer TEXT NOT NULL, author TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS views_author ON views (author, at);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, name TEXT NOT NULL, epoch INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_log (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS security_log_name ON security_log (name, at);`);
  for (const col of ['label TEXT', 'last_seen INTEGER', 'place TEXT']) { try { db.exec('ALTER TABLE sessions ADD COLUMN ' + col); } catch (e) { /* colonne déjà présente */ } }
  const getRow = db.prepare('SELECT v, version FROM kv WHERE k = ?'), putRow = db.prepare(`INSERT INTO kv (k, v, version) VALUES (?, ?, 1)
    ON CONFLICT(k) DO UPDATE SET v = excluded.v, version = version + 1`);
  const storage = { getItem: k => { const r = getRow.get(k); return r ? r.v : null; }, setItem: (k, v) => { putRow.run(k, String(v)); if (k === Social.KEY) { announce(); setImmediate(() => { try { dev.scan(); } catch (e) { console.error('Webhooks :', e); } }); } } };
  const version = () => (getRow.get(Social.KEY) || { version: 0 }).version;
  const net = Social.Net(storage);
  const tfa = Totp(db);
  // ---- sauvegardes : une par jour (et au démarrage si la dernière date de plus de 24 h), rotation automatique ----
  const backups = dbFile === ':memory:' ? null : Backups(db, opts.backupDir || path.join(path.dirname(dbFile), 'backups'), { keep: opts.backupKeep });
  const dailyBackup = () => { try { backups.daily(); } catch (e) { console.error('Sauvegarde automatique :', e); } };
  const backupTimer = backups && setInterval(dailyBackup, opts.backupCheckMs || 3600000); if (backupTimer) { backupTimer.unref(); dailyBackup(); }
  const pub = Public(net, { publicUrl: process.env.PUBLIC_URL || opts.publicUrl });
  const dev = Dev(db, net, { allowPrivate: opts.webhookPrivate || process.env.WEBHOOK_ALLOW_PRIVATE === '1' });

  // ---- temps réel (SSE) : chaque changement des données est annoncé aux clients connectés, qui rapatrient alors leur vue ----
  const live = new Set(); // { res, name }
  let announced = false;
  const emit = (c, event, data) => { try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { live.delete(c); } };
  function announce() { // regroupe les écritures d'un même tour de boucle en une seule annonce
    if (announced) return; announced = true;
    setImmediate(() => { announced = false; if (live.size) { const v = version(); for (const c of live) emit(c, 'update', { version: v }); } });
  }
  dev.onLog(owner => { for (const c of live) if (c.name === owner) emit(c, 'dev', {}); });
  const beat = setInterval(() => { for (const c of live) { try { c.res.write(': ♥\n\n'); } catch (e) { live.delete(c); } } }, 25000); beat.unref();

  // ---- publication planifiée : l'horloge du serveur publie les brouillons dont la date est arrivée ----
  const tick = () => { try { net.publishDue(); } catch (e) { console.error('Publication planifiée :', e); } };
  const sched = setInterval(tick, 5000); sched.unref(); tick();
  // suppressions de compte dont le délai de grâce est écoulé (lancé après l'initialisation complète, jamais au démarrage)
  const reap = () => {
    try {
      for (const n of net.dueDeletions()) if (net.finalizeDeletion(n)) { delV.run(n.toLowerCase(), n.toLowerCase()); delUser.run(n); db.prepare('DELETE FROM security_log WHERE name = ?').run(n); tfa.forget(n); dev.forget(n); }
    } catch (e) { console.error('Suppression de compte :', e); }
  };
  const reaper = setInterval(reap, 5000); reaper.unref();

  // ---- vues des posts : une vue par lecteur, par post et par heure ; jamais celles de l'auteur lui-même ----
  const insV = db.prepare('INSERT INTO views (post, viewer, author, at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM views WHERE post = ? AND viewer = ? AND at > ?)'),
    delV = db.prepare('DELETE FROM views WHERE author = ? OR viewer = ?'), getV = db.prepare('SELECT post, at FROM views WHERE author = ? AND at >= ?');
  const recordViews = (viewer, ids) => {
    const d = net.db(), now = Date.now(), byId = new Map(d.posts.map(p => [p.id, p])); let n = 0;
    for (const id of ids.slice(0, 50)) {
      const p = byId.get(+id); if (!p || p.group || p.author.toLowerCase() === viewer.toLowerCase() || net.isHidden(viewer, p.author) || net.isBlocked(p.author, viewer)) continue;
      n += Number(insV.run(p.id, viewer.toLowerCase(), p.author.toLowerCase(), now, p.id, viewer.toLowerCase(), now - 3600000).changes);
    }
    return n;
  };

  // ---- sessions ----
  const insS = db.prepare('INSERT INTO sessions (hash, name, epoch, created, expires, label, last_seen, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'), getS = db.prepare('SELECT * FROM sessions WHERE hash = ?'),
    delS = db.prepare('DELETE FROM sessions WHERE hash = ?'), delUser = db.prepare('DELETE FROM sessions WHERE name = ?'),
    trimS = db.prepare('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE name = ? ORDER BY created DESC LIMIT -1 OFFSET ?)'), purge = db.prepare('DELETE FROM sessions WHERE expires < ?');
  // journal de sécurité (connexions, échecs, changements de mot de passe, révocations) : navigateur et système seulement, jamais d'adresse IP
  const insL = db.prepare('INSERT INTO security_log (name, kind, label, at) VALUES (?, ?, ?, ?)'), trimL = db.prepare('DELETE FROM security_log WHERE name = ? AND id NOT IN (SELECT id FROM security_log WHERE name = ? ORDER BY id DESC LIMIT 200)');
  try { db.exec('ALTER TABLE security_log ADD COLUMN place TEXT'); } catch (e) { /* colonne déjà présente */ }
  // lieu approximatif : déduit du fuseau horaire annoncé par le navigateur (« Europe/Paris » → « Paris (Europe) »), jamais de l'adresse IP
  const placeOf = req => { const z = String(req && req.headers['x-timezone'] || ''); if (!/^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+){0,2}$/.test(z) || z.length > 40) return ''; const p = z.split('/'); return p.length > 1 ? `${p[p.length - 1].replace(/_/g, ' ')} (${p[0]})` : z; };
  const secLog = (name, kind, req) => { db.prepare('INSERT INTO security_log (name, kind, label, at, place) VALUES (?, ?, ?, ?, ?)').run(name, kind, req ? deviceLabel(req.headers['user-agent']) : '', Date.now(), placeOf(req)); trimL.run(name, name); };
  const openSession = (name, req, kind) => {
    const token = crypto.randomBytes(32).toString('hex'), now = Date.now();
    purge.run(now); insS.run(sha(token), name, net.epoch(name), now, now + SESSION_MS, req ? deviceLabel(req.headers['user-agent']) : 'Appareil du stream', now, placeOf(req)); trimS.run(name, MAX_SESSIONS);
    if (kind) secLog(name, kind, req);
    return { name, token };
  };
  const listS = db.prepare('SELECT hash, label, place, created, last_seen, expires FROM sessions WHERE name = ? AND expires > ? ORDER BY COALESCE(last_seen, created) DESC'), delSOne = db.prepare('DELETE FROM sessions WHERE name = ? AND hash = ?'),
    delSOthers = db.prepare('DELETE FROM sessions WHERE name = ? AND hash != ?'), touchS = db.prepare('UPDATE sessions SET last_seen = ? WHERE hash = ?'), listL = db.prepare('SELECT kind, label, place, at FROM security_log WHERE name = ? ORDER BY id DESC LIMIT 100');
  const sessionsOf = (name, cur) => listS.all(name, Date.now()).map(r => ({ id: r.hash.slice(0, 16), label: r.label || 'Navigateur', place: r.place || '', created: r.created, lastSeen: r.last_seen || r.created, current: r.hash === cur }));
  function auth(req) {
    const t = /^Bearer (cnch_[0-9a-f]{40})$/.exec(req.headers.authorization || ''); // jeton d'API personnel : n'ouvre que /api/v1/*
    if (t) { const k = dev.checkToken(t[1]); return k && { name: k.name, scopes: k.scopes, tokenId: k.id, api: true }; }
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization || ''); if (!m) return null;
    const s = getS.get(sha(m[1])); if (!s || s.expires < Date.now()) return null;
    try { if (net.epoch(s.name) !== s.epoch) { delS.run(s.hash); return null; } } catch (e) { delS.run(s.hash); return null; }
    if (Date.now() - (s.last_seen || 0) > 60000) touchS.run(Date.now(), s.hash);
    return { name: net.profile(s.name).name, hash: s.hash };
  }

  // ---- liens à usage unique (confirmation d'e-mail, mot de passe oublié) : seul le hachage du jeton est stocké ----
  const TOKEN_MS = { verify: 24 * 3600000, reset: 30 * 60000 };
  const insT = db.prepare('INSERT INTO tokens (hash, kind, name, email, expires) VALUES (?, ?, ?, ?, ?)'), getT = db.prepare('SELECT * FROM tokens WHERE hash = ?'),
    delT = db.prepare('DELETE FROM tokens WHERE hash = ?'), delTUser = db.prepare('DELETE FROM tokens WHERE name = ? AND kind = ?'), purgeT = db.prepare('DELETE FROM tokens WHERE expires < ?');
  const makeToken = (kind, name, email) => {
    const token = crypto.randomBytes(32).toString('hex'), now = Date.now();
    purgeT.run(now); delTUser.run(name, kind); insT.run(sha(token), kind, name, email, now + TOKEN_MS[kind]); // un seul lien valide à la fois
    return token;
  };
  // consommation atomique : le jeton est supprimé AVANT usage, donc jamais utilisable deux fois
  const takeToken = (kind, token) => {
    const m = /^[0-9a-f]{64}$/.exec(String(token || '')); const t = m && getT.get(sha(m[0]));
    if (!t || t.kind !== kind) throw new Http(400, 'Lien invalide ou déjà utilisé');
    delT.run(t.hash); if (t.expires < Date.now()) throw new Http(400, 'Lien expiré : demandez-en un nouveau');
    return t;
  };
  // « envoi » : sans SMTP, chaque e-mail est écrit dans data/outbox.log et sur la console du serveur (opts.mail pour brancher un vrai envoi)
  const mail = opts.mail || ((to, subject, text) => {
    const entry = `--- ${new Date().toISOString()} · à : ${to} · ${subject}\n${text}\n`;
    console.log('✉️  ' + entry);
    if (dbFile !== ':memory:') try { fs.appendFileSync(path.join(path.dirname(dbFile), 'outbox.log'), entry, { mode: 0o600 }); } catch (e) {}
  });
  const origin = () => process.env.PUBLIC_URL || opts.publicUrl || 'http://localhost:' + (server.address() ? server.address().port : 8080);
  // e-mails de notification (immédiats hors heures calmes) et résumés quotidiens, selon les préférences de chaque compte
  const mailTick = () => { try { for (const j of net.mailJobs(origin())) mail(j.to, j.subject, j.text); } catch (e) { console.error('E-mails de notification :', e); } };
  const mailer = setInterval(mailTick, opts.mailCheckMs || 5000); mailer.unref();

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
    if (/^POST \/api\/(signup|login|stream-session|forgot|reset|verify-email)$/.test(route) && limited(req)) throw new Http(429, 'Trop de requêtes : réessayez dans une minute');
    if (route === 'POST /api/signup') { const b = await body(req); const name = await net.signup(b.name, b.password, b.bio); return send(res, 200, openSession(name, req, 'signup')); }
    if (route === 'POST /api/login') {
      const b = await body(req); let name;
      try { name = await net.login(String(b.name || ''), String(b.password || '')); } catch (e) {
        try { secLog(net.profile(String(b.name || '')).name, 'login_fail', req); } catch (x) { /* compte inconnu : rien à journaliser */ }
        throw e;
      }
      // double authentification : appareil de confiance, sinon code TOTP ou code de secours
      if (!tfa.enabled(name) || tfa.isTrusted(name, b.trusted)) return send(res, 200, openSession(name, req, 'login'));
      if (!b.code) return send(res, 200, { mfa: true });
      if (!tfa.verify(name, b.code)) { secLog(name, 'mfa_fail', req); throw new Http(400, 'Code incorrect'); }
      return send(res, 200, Object.assign(openSession(name, req, 'login'), b.trust ? { trusted: tfa.trust(name, req.headers['user-agent']) } : {}));
    }
    // vue du stream : ouvre le vrai compte « Streamer » SANS mot de passe, uniquement depuis la machine du serveur
    if (route === 'POST /api/stream-session') {
      if (!loopback(req)) throw new Http(403, 'Réservé à la machine du stream');
      return send(res, 200, openSession(await net.ensureStreamer(), req));
    }
    // récupération de compte (sans session) : réponse identique que le compte existe ou non
    if (route === 'POST /api/forgot') {
      const b = await body(req), u = net.findRecoverable(b.id);
      if (u) mail(u.email, 'Cornichon : réinitialisation du mot de passe', `Bonjour @${u.name},\n\nPour choisir un nouveau mot de passe (lien à usage unique, valable 30 minutes) :\n${origin()}/?reset=${makeToken('reset', u.name, u.email)}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`);
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/reset') {
      const b = await body(req), pw = String(b.password || '');
      if (pw.length < 4) throw new Http(400, 'Nouveau mot de passe trop court (4 min)');
      const t = takeToken('reset', b.token), u = net.findRecoverable(t.name);
      if (!u || u.email !== t.email) throw new Http(400, 'Lien invalide : l\'adresse du compte a changé');
      await net.resetPassword(t.name, pw); tfa.revokeDevices(t.name); delUser.run(t.name); delTUser.run(t.name, 'reset'); secLog(t.name, 'password_reset', req); // toutes les sessions actives sont révoquées
      return send(res, 200, { ok: true, name: t.name });
    }
    if (route === 'POST /api/verify-email') {
      const b = await body(req), t = takeToken('verify', b.token);
      return send(res, 200, { ok: true, name: net.confirmEmail(t.name, t.email), email: t.email });
    }
    const me = auth(req); if (!me) throw new Http(401, 'Session expirée : reconnectez-vous');
    // ---- API publique (jeton personnel ou session) : lire et publier ----
    if (url.pathname.startsWith('/api/v1/')) {
      if (me.api && dev.limited(me.tokenId)) throw new Http(429, 'Trop de requêtes : 60 par minute et par jeton');
      const need = s => { if (me.api && !me.scopes.includes(s)) throw new Http(403, 'Ce jeton n\'a pas la permission « ' + s + ' »'); };
      const pub = p => ({ id: p.id, author: p.author, text: p.text, at: p.at, replyTo: p.replyTo || null, likes: p.likes.length });
      const lim = () => Math.min(50, Math.max(1, +url.searchParams.get('limit') || 20));
      if (route === 'GET /api/v1/me') { need('read'); return send(res, 200, { name: me.name, bio: net.profile(me.name).bio, followers: net.followers(me.name).length, following: net.profile(me.name).following.length, scopes: me.api ? me.scopes : ['read', 'write'] }); }
      if (route === 'GET /api/v1/feed') { need('read'); return send(res, 200, { posts: net.page(me.name, 'feed', { limit: lim(), before: url.searchParams.get('before') }).posts.map(pub) }); }
      if (route === 'GET /api/v1/followers') { need('read'); return send(res, 200, { followers: net.followers(me.name) }); }
      if (route === 'GET /api/v1/mentions') {
        need('read'); const d = net.db(), seen = new Set();
        return send(res, 200, { mentions: net.notifications(me.name).filter(n => n.type === 'mention' && !seen.has(n.postId) && seen.add(n.postId)).slice(0, lim()).map(n => d.posts.find(p => p.id === n.postId)).filter(Boolean).map(pub) });
      }
      if (route === 'POST /api/v1/posts') { need('write'); const b = await body(req); return send(res, 200, pub(await net.post(me.name, String(b.text || ''), b.replyTo ? +b.replyTo : undefined))); }
      throw new Http(404, 'Route inconnue');
    }
    if (me.api) throw new Http(403, 'Un jeton d\'API ne donne accès qu\'à /api/v1/*');
    // ---- gestion des jetons et des webhooks : réservée à la session du propriétaire ----
    if (url.pathname.startsWith('/api/dev')) {
      const dv = url.pathname.slice(8);
      if (route === 'GET /api/dev') return send(res, 200, { tokens: dev.tokens(me.name), hooks: dev.hooks(me.name), log: dev.log(me.name), events: dev.EVENTS });
      if (route === 'GET /api/dev/delivery') return send(res, 200, dev.detail(me.name, url.searchParams.get('id')));
      if (req.method === 'POST') {
        const b = await body(req);
        if (dv === '/token') return send(res, 200, dev.createToken(me.name, b.label, b.scopes));
        if (dv === '/token-revoke') { dev.revokeToken(me.name, b.id); return send(res, 200, { ok: true }); }
        if (dv === '/hook') return send(res, 200, dev.createHook(me.name, b.url, b.events));
        if (dv === '/hook-update') { dev.updateHook(me.name, b.id, b); return send(res, 200, { ok: true }); }
        if (dv === '/hook-delete') { dev.deleteHook(me.name, b.id); return send(res, 200, { ok: true }); }
        if (dv === '/hook-test') return send(res, 200, await dev.testHook(me.name, b.id, b.event));
        if (dv === '/redeliver') return send(res, 200, await dev.redeliver(me.name, b.id));
      }
      throw new Http(404, 'Route inconnue');
    }
    // ---- sauvegardes et restauration : réservées aux administrateurs ----
    if (url.pathname.startsWith('/api/admin/backups')) {
      if (!net.isAdmin(me.name)) throw new Http(403, 'Réservé à l\'administrateur');
      if (!backups) throw new Http(400, 'Sauvegardes indisponibles avec une base en mémoire');
      const sub = url.pathname.slice('/api/admin/backups'.length), state = () => ({ backups: backups.list(), keep: backups.keep(), min: backups.MIN_KEEP, max: backups.MAX_KEEP });
      if (route === 'GET /api/admin/backups') return send(res, 200, state());
      const dl = /^\/([^/]+)\/download$/.exec(sub);
      if (dl && req.method === 'GET') {
        const f = backups.file(decodeURIComponent(dl[1]));
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${path.basename(f)}"`, 'Cache-Control': 'no-store' }, HEAD));
        return res.end(fs.readFileSync(f));
      }
      if (req.method === 'POST') {
        const b = await body(req);
        if (sub === '/create') { backups.create('manual'); return send(res, 200, state()); }
        if (sub === '/keep') { backups.setKeep(b.keep); return send(res, 200, state()); }
        if (sub === '/delete') { backups.remove(String(b.id || '')); return send(res, 200, state()); }
        if (sub === '/restore') {
          if (b.confirm !== true) throw new Http(400, 'Confirmation requise');
          const before = version(), r = backups.restore(String(b.id || ''));
          db.prepare('UPDATE kv SET version = ? WHERE k = ?').run(before + 1, Social.KEY); // les clients doivent rapatrier la vue restaurée, même si elle est plus ancienne
          announce(); return send(res, 200, Object.assign(r, state()));
        }
      }
      throw new Http(404, 'Route inconnue');
    }
    if (route === 'POST /api/view') { const b = await body(req); return send(res, 200, { n: Array.isArray(b.ids) ? recordViews(me.name, b.ids) : 0 }); }
    if (route === 'GET /api/stats') {
      const days = Math.min(Stats.MAX_DAYS, Math.max(1, +url.searchParams.get('days') || 14));
      return send(res, 200, Stats.compute(net.db(), getV.all(me.name.toLowerCase(), Date.now() - (days + 1) * 86400000), me.name, days, url.searchParams.get('tz'), Date.now()));
    }
    if (route === 'GET /api/state') {
      tick();
      const v = version();
      if (+url.searchParams.get('v') === v) return send(res, 200, { unchanged: true, version: v, me: me.name });
      return send(res, 200, { version: v, me: me.name, state: Social.snapshot(net.db(), me.name) });
    }
    // flux temps réel : la session reste authentifiée par l'en-tête Authorization (le client lit le flux avec fetch)
    if (route === 'GET /api/stream') {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }, HEAD));
      const c = { res, name: me.name }; live.add(c); res.on('close', () => live.delete(c));
      emit(c, 'hello', { version: version(), me: me.name }); return;
    }
    // pagination côté serveur du fil (scope=feed|explore) : ?limit=&before=<id> pour la suite, ?after=<id> pour compter les nouveaux posts
    if (route === 'GET /api/feed') {
      const sc = url.searchParams.get('scope'); if (!['feed', 'explore', 'list', 'group', 'search', 'notifs', 'convs', 'dm'].includes(sc)) throw new Http(400, 'Fil inconnu');
      return send(res, 200, net.page(me.name, sc, { owner: url.searchParams.get('owner'), list: url.searchParams.get('list'), group: url.searchParams.get('group'), q: url.searchParams.get('q'), sort: url.searchParams.get('sort'), peer: url.searchParams.get('peer'), limit: url.searchParams.get('limit'), before: url.searchParams.get('before'), after: url.searchParams.get('after') }));
    }
    // « X est en train d'écrire » : éphémère, jamais stocké, transmis seulement au destinataire connecté
    if (route === 'POST /api/typing') {
      const b = await body(req), to = net.profile(String(b.to || '')).name;
      if (to !== me.name && !net.isHidden(to, me.name) && !net.isBlocked(me.name, to) && !net.isBlocked(to, me.name)) for (const c of live) if (c.name === to) emit(c, 'typing', { from: me.name });
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/email') {
      const b = await body(req); if (limited(req)) throw new Http(429, 'Trop de requêtes : réessayez dans une minute');
      const r = net.setEmail(me.name, b.email);
      if (!r.verified) mail(r.email, 'Cornichon : confirmez votre adresse e-mail', `Bonjour @${me.name},\n\nConfirmez cette adresse (lien valable 24 h) :\n${origin()}/?verify=${makeToken('verify', me.name, r.email)}\n\nSi ce n'est pas vous, ignorez ce message.`);
      return send(res, 200, r);
    }
    if (route === 'POST /api/email-remove') { net.removeEmail(me.name); delTUser.run(me.name, 'verify'); delTUser.run(me.name, 'reset'); return send(res, 200, { ok: true }); }
    // ---- double authentification (réservée à la session du propriétaire) ----
    if (url.pathname.startsWith('/api/2fa')) {
      const sub = url.pathname.slice(8), state = () => ({ enabled: tfa.enabled(me.name), pending: tfa.pending(me.name), backupLeft: tfa.backupLeft(me.name), devices: tfa.devices(me.name) });
      if (route === 'GET /api/2fa') return send(res, 200, state());
      if (req.method === 'POST') {
        if (limited(req)) throw new Http(429, 'Trop de requêtes : réessayez dans une minute');
        const b = await body(req), pw = async () => { await net.login(me.name, String(b.password || '')); };
        if (sub === '/setup') return send(res, 200, tfa.setup(me.name));
        if (sub === '/enable') { const codes = tfa.enable(me.name, b.code); return send(res, 200, Object.assign({ codes }, b.trust ? { trusted: tfa.trust(me.name, req.headers['user-agent']) } : {})); }
        if (sub === '/disable') { await pw(); if (!tfa.enabled(me.name) || !tfa.verify(me.name, b.code)) throw new Http(400, 'Code incorrect'); tfa.disable(me.name); return send(res, 200, { ok: true }); }
        if (sub === '/backup') { await pw(); if (!tfa.enabled(me.name) || !tfa.verify(me.name, b.code)) throw new Http(400, 'Code incorrect'); return send(res, 200, { codes: tfa.regenerate(me.name) }); }
        if (sub === '/device-revoke') { tfa.revokeDevice(me.name, b.id); return send(res, 200, { ok: true }); }
        if (sub === '/devices-revoke') { tfa.revokeDevices(me.name); return send(res, 200, { ok: true }); }
      }
      throw new Http(404, 'Route inconnue');
    }
    if (route === 'GET /api/sessions') return send(res, 200, { sessions: sessionsOf(me.name, me.hash), log: listL.all(me.name) });
    if (route === 'POST /api/session-revoke') { // révoque un appareil (jamais celui-ci : pour cela, « Quitter »)
      const b = await body(req), id = String(b.id || ''), s = /^[0-9a-f]{16}$/.test(id) && listS.all(me.name, Date.now()).find(r => r.hash.startsWith(id));
      if (!s) throw new Http(404, 'Session introuvable'); if (s.hash === me.hash) throw new Http(400, 'C\'est la session de cet appareil : utilisez « Quitter »');
      delSOne.run(me.name, s.hash); secLog(me.name, 'session_revoked', req); return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/sessions-revoke') { delSOthers.run(me.name, me.hash); secLog(me.name, 'sessions_revoked', req); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/logout') { delS.run(me.hash); secLog(me.name, 'logout', req); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/logout-all') { secLog(me.name, 'logout_all', req); net.logoutAll(me.name); tfa.revokeDevices(me.name); delUser.run(me.name); dev.revokeAll(me.name); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/password') {
      const b = await body(req); await net.changePassword(me.name, String(b.oldPw || ''), String(b.newPw || ''));
      delUser.run(me.name); tfa.revokeDevices(me.name); return send(res, 200, openSession(me.name, req, 'password_change')); // les autres appareils sont déconnectés
    }
    if (route === 'POST /api/delete-account') { const b = await body(req); await net.deleteAccount(me.name, String(b.password || '')); delV.run(me.name.toLowerCase(), me.name.toLowerCase()); delUser.run(me.name); db.prepare('DELETE FROM security_log WHERE name = ?').run(me.name); tfa.forget(me.name); dev.forget(me.name); return send(res, 200, { ok: true }); }
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
      if (req.method === 'GET' || req.method === 'HEAD') {
        const r = pub.handle(req, url);
        if (r) { res.writeHead(r.status, Object.assign({ 'Content-Type': r.type, 'Cache-Control': 'public, max-age=60' }, HEAD, { 'Content-Security-Policy': "default-src 'none'; img-src https: data: 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" })); return res.end(req.method === 'HEAD' ? undefined : r.body); }
      }
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
  server.on('close', () => { clearInterval(beat); clearInterval(sched); clearInterval(reaper); clearInterval(mailer); if (backupTimer) clearInterval(backupTimer); for (const c of live) c.res.end(); live.clear(); db.close(); });
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
