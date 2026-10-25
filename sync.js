// Client de synchronisation : le navigateur ne garde qu'une copie en lecture de SA vue des données (envoyée par le serveur) ;
// toute modification passe par l'API et la session (clé « app.session », propre à chaque visiteur) prouve qui agit.
(function (root) {
  const WRITES = ['post', 'deletePost', 'editPost', 'toggleBookmark', 'toggleTopic', 'toggleRepost', 'toggleLike', 'react', 'quote', 'toggleFollow', 'updateProfile', 'importUser', 'send', 'toggleBlock', 'toggleMute', 'report', 'moderate', 'liftSanction', 'appeal', 'decideAppeal', 'adminSanction', 'adminDeleteUser', 'exportUser', 'markDmRead', 'deleteConversation', 'saveDraft', 'deleteDraft', 'publishDraft', 'createList', 'updateList', 'deleteList', 'toggleListMember', 'dismissSuggestion', 'vote', 'createGroup', 'updateGroup', 'deleteGroup', 'joinGroup', 'leaveGroup', 'handleRequest', 'inviteToGroup', 'respondInvite', 'cancelInvite', 'removeFromGroup', 'unbanFromGroup', 'setGroupMod'];
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
    // appareils de confiance (par navigateur, clé « app.trusted ») : un jeton par pseudo, envoyé à la connexion pour passer l'étape du code
    const trustedKey = 'app.trusted', trustedAll = () => { try { return JSON.parse(store.getItem(trustedKey) || '{}'); } catch (e) { return {}; } };
    const trustedSet = (name, t) => { const m = trustedAll(); if (t) m[name.toLowerCase()] = t; else delete m[name.toLowerCase()]; store.setItem(trustedKey, JSON.stringify(m)); };
    // renvoie { mfa: true } quand le serveur attend un code (double authentification)
    net.login = async (name, password, code, trust) => {
      const j = await req('/api/login', 'POST', { name, password, code, trust, trusted: trustedAll()[String(name).toLowerCase()] });
      if (j.mfa) return { mfa: true };
      if (j.trusted) trustedSet(j.name, j.trusted);
      return open(j);
    };
    net.trustDevice = (name, t) => trustedSet(name, t);
    net.ensureStreamer = async () => open(await req('/api/stream-session', 'POST', {}));
    net.changePassword = async (by, oldPw, newPw) => { await open(await req('/api/password', 'POST', { oldPw, newPw })); };
    net.setEmail = async (by, email) => { const j = await req('/api/email', 'POST', { email }); await pull(true); return j; };
    net.removeEmail = async () => { await req('/api/email-remove', 'POST', {}); await pull(true); };
    // récupération (sans session) : ne touche pas à la session de cet appareil
    net.forgot = async id => { await req('/api/forgot', 'POST', { id }); };
    net.reset = (token, password) => req('/api/reset', 'POST', { token, password });
    net.verifyEmail = async token => { const j = await req('/api/verify-email', 'POST', { token }); if (session()) await pull(true).catch(() => {}); return j; };
    net.logoutAll = async () => { await req('/api/logout-all', 'POST', {}); forget(); };
    net.deleteAccount = async (by, password) => { await req('/api/delete-account', 'POST', { password }); forget(); };
    // flux temps réel (SSE lu avec fetch pour garder l'en-tête Authorization) ; reconnexion automatique, interrogation en secours
    let liveOn = false, stopLive = false;
    function live(on) {
      if (liveOn || typeof fetch === 'undefined') return; liveOn = true; stopLive = false;
      (async function loop(wait) {
        while (!stopLive && session()) {
          try {
            const s = session(), r = await fetch('/api/stream', { headers: { Authorization: 'Bearer ' + s.token } });
            if (r.status === 401) { forget(); onChange(); break; }
            if (!r.ok || !r.body) throw new Error('flux');
            const rd = r.body.getReader(), dec = new TextDecoder(); let buf = ''; wait = 1000; connected = true;
            for (;;) {
              const { done, value } = await rd.read(); if (done) break;
              buf += dec.decode(value, { stream: true });
              let i; while ((i = buf.indexOf('\n\n')) >= 0) {
                const blk = buf.slice(0, i); buf = buf.slice(i + 2);
                const ev = /^event: (.+)$/m.exec(blk), dat = /^data: (.+)$/m.exec(blk);
                if (ev && dat) { try { on(ev[1], JSON.parse(dat[1])); } catch (e) {} }
              }
            }
          } catch (e) {}
          connected = false;
          await new Promise(ok => setTimeout(ok, wait)); wait = Math.min(wait * 2, 15000);
        }
        liveOn = false; connected = false;
      })(1000);
    }
    let connected = false;
    const typing = to => req('/api/typing', 'POST', { to }).catch(() => {});
    const logout = () => { req('/api/logout', 'POST', {}).catch(() => {}); forget(); };
    return { net, pull, poll, logout, live, typing, get: p => req(p, 'GET'), blob: async p => { const s = session(), r = await fetch(p, { headers: s ? { Authorization: 'Bearer ' + s.token } : {} }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || failure(r.status)); return r.blob(); }, send: (p, data) => req(p, 'POST', data), connected: () => connected, stopLive: () => { stopLive = true; }, hasSession: () => !!session(), me: () => me, online: () => online, onChange: f => { onChange = f; } };
  }
  const exported = { Sync, WRITES };
  if (typeof module !== 'undefined') module.exports = exported; else root.Sync = Sync;
})(this);
