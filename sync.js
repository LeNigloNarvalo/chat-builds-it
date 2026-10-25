// Client de synchronisation : le navigateur ne garde qu'une copie en lecture de SA vue des données (envoyée par le serveur) ;
// toute modification passe par l'API et la session (clé « app.session », propre à chaque visiteur) prouve qui agit.
(function (root) {
  const WRITES = ['post', 'deletePost', 'editPost', 'toggleBookmark', 'toggleRepost', 'toggleLike', 'toggleFollow', 'updateProfile', 'importUser', 'send', 'toggleBlock', 'toggleMute', 'report', 'moderate', 'liftSanction', 'exportUser'];
  function Sync(store, SESSION) {
    const replica = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } };
    const base = Social.Net(replica);
    let version = -1, me = null, online = true, onChange = () => {}, chain = Promise.resolve(), reading = false;
    const session = () => { const [n, t] = (store.getItem(SESSION) || '').split('|'); return t ? { name: n, token: t } : null; };
    const forget = () => { store.removeItem(SESSION); me = null; version = -1; replica.d = {}; };
    // message clair quand le serveur ne renvoie pas d'erreur lisible (proxy, redémarrage, panne)
    const failure = status => status === 404 ? 'Service introuvable : le serveur Cornichon est-il bien lancé ?' : status === 429 ? 'Trop de requêtes : réessayez dans une minute'
      : status >= 502 && status <= 504 ? 'Le serveur redémarre ou est surchargé : réessayez dans un instant' : 'Erreur du serveur (' + status + ') : réessayez dans un instant';
    async function req(path, method, data) {
      const s = session(), h = { 'Content-Type': 'application/json' };
      if (s) h.Authorization = 'Bearer ' + s.token;
      let r;
      try { r = await fetch(path, { method, headers: h, body: data === undefined ? undefined : JSON.stringify(data) }); } catch (e) { online = false; throw new Error('Serveur injoignable : réessayez dans un instant'); }
      online = true;
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && s) { forget(); onChange(); }
      if (!r.ok) throw new Error(j.error || failure(r.status));
      return j;
    }
    // récupère la vue du serveur si elle a changé ; renvoie true si les données ont bougé
    const pull = force => (chain = chain.catch(() => {}).then(async () => {
      if (!session()) { const had = me !== null; me = null; return had; }
      if (force) version = -1;
      const j = await req('/api/state?v=' + version, 'GET');
      me = j.me; if (j.unchanged) return false;
      version = j.version; replica.setItem(Social.KEY, JSON.stringify(j.state)); return true;
    }));
    const poll = () => pull().then(changed => { if (changed) onChange(); }, () => {});
    const open = async j => { store.setItem(SESSION, j.name + '|' + j.token); await pull(true); return j.name; };
    const net = Object.assign({}, base);
    for (const m of WRITES) net[m] = async (by, ...args) => { const j = await req('/api/call', 'POST', { method: m, args }); await pull(); return j.result; };
    // lecture des notifications : le serveur les marque lues, la copie locale se met à jour au prochain rafraîchissement
    net.notifications = (by, markRead) => {
      const l = base.notifications(by);
      if (markRead && !reading && l.some(n => !n.read)) { reading = true; req('/api/read-notifications', 'POST', {}).then(() => pull(), () => {}).then(c => { reading = false; if (c) onChange(); }); }
      return l;
    };
    net.signup = async (name, password, bio) => open(await req('/api/signup', 'POST', { name, password, bio }));
    net.login = async (name, password) => open(await req('/api/login', 'POST', { name, password }));
    net.ensureStreamer = async () => open(await req('/api/stream-session', 'POST', {}));
    net.changePassword = async (by, oldPw, newPw) => { await open(await req('/api/password', 'POST', { oldPw, newPw })); };
    net.logoutAll = async () => { await req('/api/logout-all', 'POST', {}); forget(); };
    net.deleteAccount = async (by, password) => { await req('/api/delete-account', 'POST', { password }); forget(); };
    const logout = () => { req('/api/logout', 'POST', {}).catch(() => {}); forget(); };
    return { net, pull, poll, logout, hasSession: () => !!session(), me: () => me, online: () => online, onChange: f => { onChange = f; } };
  }
  const exported = { Sync, WRITES };
  if (typeof module !== 'undefined') module.exports = exported; else root.Sync = Sync;
})(this);
