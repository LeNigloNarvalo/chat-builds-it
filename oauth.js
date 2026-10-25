// Connexion avec Google ou GitHub (OAuth 2.0, flux « code d'autorisation » + PKCE) et liaison de plusieurs identités à un compte.
// Les secrets des fournisseurs viennent de l'environnement (GOOGLE_CLIENT_ID / _SECRET, GITHUB_CLIENT_ID / _SECRET) ; sans eux le bouton est grisé.
// Le serveur ne garde que (fournisseur, identifiant du compte chez lui, adresse affichée) : jamais de jeton d'accès.
const crypto = require('crypto');

const STATE_MS = 10 * 60000, TICKET_MS = 5 * 60000, MAX_TRIES = 5;
const DEFAULTS = {
  google: { name: 'Google', authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', userUrl: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile' },
  github: { name: 'GitHub', authUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', userUrl: 'https://api.github.com/user', emailsUrl: 'https://api.github.com/user/emails', scope: 'read:user user:email' }
};
const b64u = b => Buffer.from(b).toString('base64url'), rnd = () => b64u(crypto.randomBytes(24));

function OAuth(db, opts = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS oauth_identity (provider TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (provider, subject));
    CREATE INDEX IF NOT EXISTS oauth_identity_name ON oauth_identity (name);
    CREATE TABLE IF NOT EXISTS oauth_nopass (name TEXT PRIMARY KEY);`);
  const byId = db.prepare('SELECT * FROM oauth_identity WHERE provider = ? AND subject = ?'), listI = db.prepare('SELECT provider, label, created, last_used FROM oauth_identity WHERE name = ? ORDER BY created'),
    insI = db.prepare('INSERT INTO oauth_identity (provider, subject, name, label, created) VALUES (?, ?, ?, ?, ?)'), delI = db.prepare('DELETE FROM oauth_identity WHERE name = ? AND provider = ?'),
    useI = db.prepare('UPDATE oauth_identity SET last_used = ? WHERE provider = ? AND subject = ?'), delIU = db.prepare('DELETE FROM oauth_identity WHERE name = ?'),
    getNP = db.prepare('SELECT 1 FROM oauth_nopass WHERE name = ?'), insNP = db.prepare('INSERT OR IGNORE INTO oauth_nopass (name) VALUES (?)'), delNP = db.prepare('DELETE FROM oauth_nopass WHERE name = ?');
  const cfg = id => {
    const d = DEFAULTS[id]; if (!d) return null;
    const o = Object.assign({}, d, (opts.providers || {})[id] || {}), P = id.toUpperCase();
    o.clientId = o.clientId || process.env[P + '_CLIENT_ID']; o.clientSecret = o.clientSecret || process.env[P + '_CLIENT_SECRET'];
    return o;
  };
  const enabled = id => { const c = cfg(id); return !!(c && c.clientId && c.clientSecret); };
  const states = new Map(), tickets = new Map(); // à usage unique, en mémoire, expirés au fil de l'eau
  const sweep = m => { const t = Date.now(); for (const [k, v] of m) if (v.exp < t) m.delete(k); if (m.size > 5000) m.delete(m.keys().next().value); };

  const fetchJson = async (url, init) => {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(8000) }, init, { headers: Object.assign({ Accept: 'application/json', 'User-Agent': 'agora-oauth' }, (init || {}).headers) }));
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('Le fournisseur a refusé la requête (' + r.status + ')'); return j;
  };
  // profil normalisé : { subject, label } ; l'adresse n'est gardée que pour l'affichage (« lié à … »)
  async function profile(id, token) {
    const c = cfg(id), h = { Authorization: 'Bearer ' + token }, u = await fetchJson(c.userUrl, { headers: h });
    if (id === 'github') {
      let email = u.email; try { const l = await fetchJson(c.emailsUrl, { headers: h }); const v = Array.isArray(l) && (l.find(e => e.primary && e.verified) || l.find(e => e.verified)); if (v) email = v.email; } catch (e) { /* adresse facultative */ }
      if (u.id === undefined) throw new Error('Profil GitHub illisible');
      return { subject: String(u.id), label: u.login ? '@' + u.login + (email ? ' · ' + email : '') : email || 'GitHub' };
    }
    if (!u.sub) throw new Error('Profil Google illisible');
    return { subject: String(u.sub), label: u.email_verified === false ? u.name || 'Google' : u.email || u.name || 'Google' };
  }

  const api = {
    providers: () => Object.keys(DEFAULTS).map(id => ({ id, name: DEFAULTS[id].name, enabled: enabled(id) })),
    enabled,
    // URL de redirection vers le fournisseur ; mode « link » : l'identité sera ajoutée au compte `name`
    start(id, mode, name, redirectUri) {
      if (!enabled(id)) throw new Error('Connexion ' + (DEFAULTS[id] ? DEFAULTS[id].name : 'inconnue') + ' non configurée sur ce serveur');
      sweep(states); const c = cfg(id), state = rnd(), verifier = rnd();
      states.set(state, { id, mode, name, verifier, redirectUri, exp: Date.now() + STATE_MS });
      const q = new URLSearchParams({ response_type: 'code', client_id: c.clientId, redirect_uri: redirectUri, scope: c.scope, state, code_challenge: b64u(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' });
      if (id === 'google') q.set('prompt', 'select_account');
      return c.authUrl + (c.authUrl.includes('?') ? '&' : '?') + q;
    },
    // retour du fournisseur : renvoie { mode, name?, ticket? } ou lève une erreur lisible
    async callback(query) {
      const st = states.get(String(query.state || '')); states.delete(String(query.state || ''));
      if (!st || st.exp < Date.now()) throw new Error('Connexion expirée : recommencez');
      if (query.error) throw new Error('Connexion annulée auprès de ' + DEFAULTS[st.id].name);
      if (!query.code) throw new Error('Réponse du fournisseur incomplète');
      const c = cfg(st.id);
      const tk = await fetchJson(c.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: String(query.code), redirect_uri: st.redirectUri, client_id: c.clientId, client_secret: c.clientSecret, code_verifier: st.verifier }).toString() });
      if (!tk.access_token) throw new Error('Jeton refusé par ' + DEFAULTS[st.id].name);
      const p = await profile(st.id, tk.access_token), known = byId.get(st.id, p.subject);
      if (st.mode === 'link') {
        if (known && known.name !== st.name) throw new Error('Ce compte ' + DEFAULTS[st.id].name + ' est déjà lié à un autre compte Agora. Connectez-vous avec lui, déliez-le, puis recommencez.');
        if (!known) api.link(st.name, st.id, p.subject, p.label); else useI.run(Date.now(), st.id, p.subject);
        return { mode: 'link', provider: st.id };
      }
      sweep(tickets); const ticket = rnd();
      tickets.set(ticket, known ? { kind: 'login', name: known.name, id: st.id, subject: p.subject, tries: 0, exp: Date.now() + TICKET_MS } : { kind: 'new', id: st.id, subject: p.subject, label: p.label, tries: 0, exp: Date.now() + TICKET_MS });
      return { mode: 'login', ticket };
    },
    // billet de connexion : consultable (pour demander un code 2FA) puis consommé par `take`
    peek(ticket) {
      const t = tickets.get(String(ticket || '')); if (!t || t.exp < Date.now()) { tickets.delete(String(ticket || '')); throw new Error('Connexion expirée : recommencez'); }
      if (++t.tries > MAX_TRIES * 2) { tickets.delete(String(ticket)); throw new Error('Trop d\'essais : recommencez la connexion'); }
      return t;
    },
    take(ticket) { tickets.delete(String(ticket)); },
    suggest(label) { const s = String(label).replace(/^@/, '').split(/[ ·@]/)[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20); return s.length >= 3 ? s : ''; },
    link(name, id, subject, label) {
      if (listI.all(name).some(x => x.provider === id)) throw new Error('Un compte ' + DEFAULTS[id].name + ' est déjà lié : déliez-le d\'abord');
      insI.run(id, subject, name, String(label).slice(0, 120), Date.now());
    },
    touch(id, subject) { useI.run(Date.now(), id, subject); },
    list: name => listI.all(name),
    // comptes créés via un fournisseur : mot de passe aléatoire inconnu de la personne tant qu'elle n'en choisit pas un
    markNoPassword: name => insNP.run(name), hasPassword: name => !getNP.get(name), setHasPassword: name => delNP.run(name),
    // garde-fou anti-verrouillage : nombre de moyens de se connecter (mot de passe, clés d'accès, identités)
    methods(name, passkeyCount) { return (api.hasPassword(name) ? 1 : 0) + passkeyCount + listI.all(name).length; },
    unlink(name, id, passkeyCount) {
      if (!listI.all(name).some(x => x.provider === id)) throw new Error('Aucune identité ' + (DEFAULTS[id] ? DEFAULTS[id].name : '') + ' liée');
      if (api.methods(name, passkeyCount) <= 1) throw new Error('Impossible : ce serait votre dernier moyen de connexion. Définissez d\'abord un mot de passe ou ajoutez une autre méthode.');
      delI.run(name, id);
    },
    forget: name => { delIU.run(name); delNP.run(name); }
  };
  return api;
}

module.exports = { OAuth };
