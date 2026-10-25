// Jetons d'API personnels et webhooks (côté serveur). Les jetons ne sont stockés que sous forme de hachage SHA-256 (affichés une seule fois) ;
// les webhooks reçoivent un JSON signé (HMAC-SHA256 du corps avec le secret du webhook) pour chaque nouvelle mention ou nouvel abonné,
// et chaque envoi (réussi ou non) est consigné dans un journal consultable et rejouable.
const crypto = require('crypto'), http = require('http'), https = require('https'), dns = require('dns'), nodeNet = require('net');

const SCOPES = ['read', 'write'], EVENTS = ['mention', 'follow'];
const MAX_TOKENS = 20, MAX_HOOKS = 10, KEEP_LOG = 100, TIMEOUT_MS = 5000, MAX_FAILS = 10, API_PER_MIN = 60;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// adresses internes refusées par défaut (évite qu'un webhook serve à sonder le réseau du serveur)
const PRIVATE = new nodeNet.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 4]]) PRIVATE.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(a, p, 'ipv6');
const isPrivate = ip => { const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); if (m) ip = m[1]; return PRIVATE.check(ip, nodeNet.isIPv6(ip) ? 'ipv6' : 'ipv4'); };

function Dev(db, net, opts) {
  opts = opts || {};
  const allowPrivate = !!opts.allowPrivate;
  db.exec(`CREATE TABLE IF NOT EXISTS api_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, label TEXT NOT NULL, scopes TEXT NOT NULL, prefix TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER, uses INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS webhooks (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, fails INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, hook INTEGER NOT NULL, owner TEXT NOT NULL, event TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, status INTEGER, ms INTEGER, error TEXT, payload TEXT NOT NULL, response TEXT, test INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS dev_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);`);
  const q = s => db.prepare(s);
  const insTok = q('INSERT INTO api_tokens (hash, owner, label, scopes, prefix, created) VALUES (?, ?, ?, ?, ?, ?)'), byHash = q('SELECT * FROM api_tokens WHERE hash = ?'),
    useTok = q('UPDATE api_tokens SET last_used = ?, uses = uses + 1 WHERE id = ?'), listTok = q('SELECT id, label, scopes, prefix, created, last_used, uses FROM api_tokens WHERE owner = ? ORDER BY id DESC'),
    delTok = q('DELETE FROM api_tokens WHERE id = ? AND owner = ?'), delToks = q('DELETE FROM api_tokens WHERE owner = ?'), countTok = q('SELECT COUNT(*) n FROM api_tokens WHERE owner = ?');
  const insHook = q('INSERT INTO webhooks (owner, url, events, secret, created) VALUES (?, ?, ?, ?, ?)'), getHook = q('SELECT * FROM webhooks WHERE id = ? AND owner = ?'), hookById = q('SELECT * FROM webhooks WHERE id = ?'),
    listHook = q('SELECT * FROM webhooks WHERE owner = ? ORDER BY id DESC'), activeHooks = q('SELECT * FROM webhooks WHERE owner = ? AND active = 1'), setHook = q('UPDATE webhooks SET active = ?, events = ?, fails = ? WHERE id = ?'),
    failHook = q('UPDATE webhooks SET fails = ? WHERE id = ?'), delHook = q('DELETE FROM webhooks WHERE id = ? AND owner = ?'), delHooks = q('DELETE FROM webhooks WHERE owner = ?'), countHook = q('SELECT COUNT(*) n FROM webhooks WHERE owner = ?');
  const insDel = q('INSERT INTO deliveries (hook, owner, event, at, ok, status, ms, error, payload, response, test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    listDel = q('SELECT id, hook, event, at, ok, status, ms, error, test FROM deliveries WHERE owner = ? ORDER BY id DESC LIMIT 50'), getDel = q('SELECT * FROM deliveries WHERE id = ? AND owner = ?'),
    trimDel = q('DELETE FROM deliveries WHERE owner = ? AND id NOT IN (SELECT id FROM deliveries WHERE owner = ? ORDER BY id DESC LIMIT ' + KEEP_LOG + ')'),
    delDels = q('DELETE FROM deliveries WHERE owner = ?'), delDelsHook = q('DELETE FROM deliveries WHERE hook = ? AND owner = ?');
  const getMeta = q('SELECT v FROM dev_meta WHERE k = ?'), putMeta = q('INSERT INTO dev_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  const bad = m => new Error(m);
  let onLog = () => {};

  // ---- jetons personnels ----
  function createToken(owner, label, scopes) {
    label = String(label || '').trim().slice(0, 40); if (!label) throw bad('Donne un nom au jeton (ex. « bot Discord »)');
    scopes = [...new Set(Array.isArray(scopes) ? scopes : [])]; if (!scopes.length || scopes.some(s => !SCOPES.includes(s))) throw bad('Choisis au moins une permission : lecture et/ou publication');
    if (countTok.get(owner).n >= MAX_TOKENS) throw bad(MAX_TOKENS + ' jetons maximum : révoque-en un d\'abord');
    const token = 'cnch_' + crypto.randomBytes(20).toString('hex');
    const r = insTok.run(sha(token), owner, label, scopes.join(','), token.slice(0, 9), Date.now());
    return { token, id: Number(r.lastInsertRowid), label, scopes, prefix: token.slice(0, 9) };
  }
  // renvoie { name, scopes, id } si le jeton est valide (et compte son usage)
  function checkToken(token) {
    if (!/^cnch_[0-9a-f]{40}$/.test(token || '')) return null;
    const t = byHash.get(sha(token)); if (!t) return null;
    let name; try { name = net.profile(t.owner).name; } catch (e) { delToks.run(t.owner); return null; }
    useTok.run(Date.now(), t.id);
    return { name, scopes: t.scopes.split(','), id: t.id };
  }
  const revokeToken = (owner, id) => { if (!delTok.run(+id, owner).changes) throw bad('Jeton introuvable'); };
  const tokens = owner => listTok.all(owner).map(t => Object.assign({}, t, { scopes: t.scopes.split(',') }));
  // limite de débit par jeton
  const rate = new Map();
  const limited = id => { const now = Date.now(); let h = rate.get(id); if (!h || h.reset < now) { if (rate.size > 5000) rate.clear(); rate.set(id, h = { n: 0, reset: now + 60000 }); } return ++h.n > API_PER_MIN; };

  // ---- webhooks ----
  const cleanEvents = ev => { ev = [...new Set(Array.isArray(ev) ? ev : [])]; if (!ev.length || ev.some(e => !EVENTS.includes(e))) throw bad('Choisis au moins un évènement : nouvelle mention et/ou nouvel abonné'); return ev; };
  function createHook(owner, url, events) {
    url = String(url || '').trim(); let u; try { u = new URL(url); } catch (e) { throw bad('Adresse invalide (ex. https://exemple.org/hook)'); }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || url.length > 300) throw bad('Adresse http(s) sans identifiants, 300 caractères maximum');
    if (!allowPrivate && nodeNet.isIP(u.hostname.replace(/^\[|\]$/g, '')) && isPrivate(u.hostname.replace(/^\[|\]$/g, ''))) throw bad('Les adresses internes (localhost, réseau privé) ne sont pas autorisées');
    events = cleanEvents(events);
    if (countHook.get(owner).n >= MAX_HOOKS) throw bad(MAX_HOOKS + ' webhooks maximum');
    const secret = 'whsec_' + crypto.randomBytes(20).toString('hex');
    return { id: Number(insHook.run(owner, url, events.join(','), secret, Date.now()).lastInsertRowid) };
  }
  const shape = h => ({ id: h.id, url: h.url, events: h.events.split(','), secret: h.secret, active: !!h.active, fails: h.fails, created: h.created });
  const hooks = owner => listHook.all(owner).map(shape);
  function updateHook(owner, id, patch) {
    const h = getHook.get(+id, owner); if (!h) throw bad('Webhook introuvable');
    const active = patch.active === undefined ? !!h.active : !!patch.active, events = patch.events === undefined ? h.events : cleanEvents(patch.events).join(',');
    setHook.run(active ? 1 : 0, events, active && !h.active ? 0 : h.fails, h.id);
  }
  const deleteHook = (owner, id) => { if (!delHook.run(+id, owner).changes) throw bad('Webhook introuvable'); delDelsHook.run(+id, owner); };

  // résolution DNS contrôlée : l'adresse réellement jointe est vérifiée au moment de la connexion
  const lookup = (host, o, cb) => dns.lookup(host, o, (err, addr, fam) => {
    if (err) return cb(err);
    const list = Array.isArray(addr) ? addr : [{ address: addr, family: fam }];
    if (!allowPrivate && list.some(a => isPrivate(a.address))) return cb(new Error('Adresse interne refusée'));
    if (o && o.all) cb(null, list); else cb(null, list[0].address, list[0].family);
  });
  function post(url, body, headers) {
    return new Promise(ok => {
      const t0 = Date.now(), u = new URL(url), lib = u.protocol === 'https:' ? https : http;
      let done = false; const end = r => { if (!done) { done = true; ok(Object.assign({ ms: Date.now() - t0 }, r)); } };
      const req = lib.request(u, { method: 'POST', headers: Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers), lookup, timeout: TIMEOUT_MS }, res => {
        let txt = ''; res.setEncoding('utf8');
        res.on('data', c => { if (txt.length < 500) txt += c; }); res.on('end', () => end({ status: res.statusCode, response: txt.slice(0, 500) })); res.on('error', e => end({ error: e.message }));
        res.on('close', () => end({ status: res.statusCode, response: txt.slice(0, 500) }));
      });
      req.on('timeout', () => { req.destroy(); end({ error: 'Délai dépassé (' + TIMEOUT_MS / 1000 + ' s)' }); });
      req.on('error', e => end({ error: e.message }));
      req.end(body);
    });
  }
  // envoie un évènement à un webhook et l'écrit dans le journal ; renvoie l'entrée du journal
  async function deliver(h, event, data, test) {
    const body = JSON.stringify({ event, test: !!test, at: new Date().toISOString(), data });
    const delivery = Number(insDel.run(h.id, h.owner, event, Date.now(), 0, null, null, 'en cours', body, null, test ? 1 : 0).lastInsertRowid);
    const r = await post(h.url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Cornichon-Webhooks/1', 'X-Cornichon-Event': event, 'X-Cornichon-Delivery': String(delivery),
      'X-Cornichon-Signature': 'sha256=' + crypto.createHmac('sha256', h.secret).update(body).digest('hex') });
    const ok = !r.error && r.status >= 200 && r.status < 300;
    q('UPDATE deliveries SET ok = ?, status = ?, ms = ?, error = ?, response = ? WHERE id = ?').run(ok ? 1 : 0, r.status || null, r.ms, ok ? null : r.error || 'Réponse HTTP ' + r.status, r.response || null, delivery);
    trimDel.run(h.owner, h.owner);
    if (!test) { // un webhook qui échoue 10 fois de suite est désactivé (le propriétaire le réactive depuis la page)
      const cur = hookById.get(h.id);
      if (cur) { const fails = ok ? 0 : cur.fails + 1; failHook.run(fails, h.id); if (fails >= MAX_FAILS) setHook.run(0, cur.events, fails, h.id); }
    }
    onLog(h.owner);
    return { id: delivery, ok, code: r.status || null, error: ok ? null : r.error || 'Réponse HTTP ' + r.status, ms: r.ms };
  }
  function testHook(owner, id, event) {
    const h = getHook.get(+id, owner); if (!h) throw bad('Webhook introuvable');
    event = event || 'ping'; if (event !== 'ping' && !EVENTS.includes(event)) throw bad('Évènement inconnu');
    const data = event === 'mention' ? { from: owner, post: { id: 0, text: 'Test : @' + owner + ' ceci est une mention de test', at: Date.now() } } : event === 'follow' ? { from: owner } : { message: 'Test de webhook Cornichon', webhook: h.id };
    return deliver(h, event, Object.assign({ to: owner }, data), true);
  }
  async function redeliver(owner, id) {
    const d = getDel.get(+id, owner); if (!d) throw bad('Envoi introuvable');
    const h = getHook.get(d.hook, owner); if (!h) throw bad('Ce webhook n\'existe plus');
    const p = JSON.parse(d.payload); return deliver(h, d.event, p.data, !!d.test);
  }
  const log = owner => listDel.all(owner).map(d => Object.assign({}, d, { ok: !!d.ok, test: !!d.test }));
  const detail = (owner, id) => { const d = getDel.get(+id, owner); if (!d) throw bad('Envoi introuvable'); return { id: d.id, payload: d.payload, response: d.response }; };

  // ---- évènements : les nouvelles notifications « mention » et « abonné » sont transmises aux webhooks de leur destinataire ----
  let cursor = (getMeta.get('cursor') || {}).v;
  const init = () => { if (cursor === undefined) { cursor = Math.max(0, ...net.db().notifs.map(n => n.id)); putMeta.run('cursor', cursor); } };
  function scan() {
    init();
    const d = net.db(), fresh = d.notifs.filter(n => n.id > cursor).sort((a, b) => a.id - b.id);
    if (!fresh.length) return;
    cursor = fresh[fresh.length - 1].id; putMeta.run('cursor', cursor);
    for (const n of fresh) {
      if (n.type !== 'mention' && n.type !== 'follow') continue;
      const hs = activeHooks.all(n.to).filter(h => h.events.split(',').includes(n.type)); if (!hs.length) continue;
      const p = n.postId && d.posts.find(x => x.id === n.postId);
      const data = n.type === 'mention' ? { to: n.to, from: n.from, post: p ? { id: p.id, text: p.text, at: p.at } : { id: n.postId } } : { to: n.to, from: n.from };
      for (const h of hs) deliver(h, n.type, data, false).catch(e => console.error('Webhook :', e));
    }
  }
  const forget = owner => { delToks.run(owner); delHooks.run(owner); delDels.run(owner); };
  return { SCOPES, EVENTS, createToken, checkToken, revokeToken, tokens, limited, createHook, hooks, updateHook, deleteHook, testHook, redeliver, log, detail, scan, forget, revokeAll: owner => delToks.run(owner), onLog: f => { onLog = f; } };
}
module.exports = { Dev, isPrivate, SCOPES, EVENTS };
