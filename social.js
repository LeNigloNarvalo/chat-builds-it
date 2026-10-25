// Moteur du réseau social : les données sont PARTAGÉES via un « storage » injecté (localStorage).
// Chaque appel relit le storage (lecture-modification-écriture) : aucune copie ancienne n'est conservée en mémoire.
(function (root) {
  const KEY = 'twitchgram.v1';
  const empty = () => ({ users: {}, posts: [], messages: [], notifs: [], seq: 1, attempts: {} });
  const MAX_FAILS = 5, LOCK_MS = 60000;

  const RESERVED = 'streamer';
  const subtle = () => (root.crypto || require('crypto').webcrypto).subtle;
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha = async s => hex(await subtle().digest('SHA-256', new TextEncoder().encode(s)));
  const randHex = n => hex((root.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(n)));
  // mot de passe : jamais en clair, « sel$SHA-256(sel + mot de passe) »
  async function hashPw(pw, salt) { salt = salt || randHex(16); return salt + '$' + await sha(salt + pw); }

  function Net(storage, now) {
    now = now || Date.now;
    let db;
    const load = () => {
      try { db = Object.assign(empty(), JSON.parse(storage.getItem(KEY))); } catch (e) { db = empty(); }
      return db;
    };
    const save = () => storage.setItem(KEY, JSON.stringify(db));
    const id = () => db.seq++;
    const need = (c, m) => { if (!c) throw new Error(m); };
    const user = n => { const u = db.users[(n || '').toLowerCase()]; need(u, 'Utilisateur introuvable'); return u; };
    const notify = (to, from, type, postId) => {
      if (to === from) return;
      db.notifs.push({ id: id(), to, from, type, postId: postId || null, at: now(), read: false });
    };

    const scoreOf = p => { const h = Math.max(0, now() - p.at) / 36e5; return (1 + p.likes.length * 2 + db.posts.filter(r => r.replyTo === p.id).length * 3) * Math.pow(0.5, h / 3); };

    const api = {
      db: () => db,
      async signup(name, password, bio) {
        name = (name || '').trim();
        need(/^[a-zA-Z0-9_]{3,20}$/.test(name), 'Pseudo : 3-20 caractères (lettres, chiffres, _)');
        need(name.toLowerCase() !== RESERVED, 'Pseudo réservé');
        need((password || '').length >= 4, 'Mot de passe trop court (4 min)');
        const pass = await hashPw(password);
        load(); // relire après l'attente : un autre visiteur a pu s'inscrire entre-temps
        need(!db.users[name.toLowerCase()], 'Pseudo déjà pris');
        db.users[name.toLowerCase()] = { name, pass, bio: (bio || '').slice(0, 160), following: [], joined: now() };
        save(); return name;
      },
      // connexion limitée : MAX_FAILS échecs d'affilée verrouillent le pseudo LOCK_MS (compteur partagé)
      async login(name, password) {
        const key = (name || '').toLowerCase();
        const locked = () => { const a = load().attempts[key]; return a && a.until > now() ? Math.ceil((a.until - now()) / 1000) : 0; };
        let s = locked();
        need(!s, `Trop d'essais ratés : réessayez dans ${s} s`);
        const u0 = db.users[key];
        const ok = !!(u0 && u0.pass.includes('$') && u0.pass === await hashPw(password || '', u0.pass.split('$')[0]));
        load(); // relire après l'attente
        s = locked(); need(!s, `Trop d'essais ratés : réessayez dans ${s} s`);
        if (!ok || !db.users[key] || db.users[key].pass !== u0.pass) {
          const a = db.attempts[key] && db.attempts[key].last > now() - 10 * LOCK_MS ? db.attempts[key] : { fails: 0, until: 0 };
          a.fails++; a.last = now();
          if (a.fails >= MAX_FAILS) { a.until = now() + LOCK_MS; a.fails = 0; }
          db.attempts[key] = a; save();
          throw new Error('Identifiants invalides');
        }
        delete db.attempts[key]; save();
        return db.users[key].name;
      },
      // session valide = compte existant et même « époque » (incrémentée par « se déconnecter partout »)
      epoch: n => (user(n).epoch || 0),
      async changePassword(name, oldPw, newPw) {
        need((newPw || '').length >= 4, 'Nouveau mot de passe trop court (4 min)');
        need(newPw !== oldPw, 'Le nouveau mot de passe doit être différent');
        let u = user(name);
        need(u.pass.includes('$') && u.pass === await hashPw(oldPw || '', u.pass.split('$')[0]), 'Mot de passe actuel incorrect');
        const pass = await hashPw(newPw);
        load(); u = user(name);
        u.pass = pass; u.epoch = (u.epoch || 0) + 1; // les autres appareils sont déconnectés
        save(); return u.epoch;
      },
      logoutAll(name) { const u = user(name); u.epoch = (u.epoch || 0) + 1; save(); return u.epoch; },
      // suppression du compte avec ses posts, réponses, likes, abonnements, messages et notifications
      async deleteAccount(name, password) {
        let u = user(name);
        need(!u.admin, 'Le compte Streamer ne peut pas être supprimé');
        need(u.pass.includes('$') && u.pass === await hashPw(password || '', u.pass.split('$')[0]), 'Mot de passe incorrect');
        load(); u = user(name);
        const n = u.name, gone = new Set(db.posts.filter(p => p.author === n).map(p => p.id));
        db.posts = db.posts.filter(p => !gone.has(p.id) && !gone.has(p.replyTo));
        for (const p of db.posts) p.likes = p.likes.filter(x => x !== n);
        for (const x of Object.values(db.users)) x.following = x.following.filter(f => f !== n);
        db.messages = db.messages.filter(m => m.from !== n && m.to !== n);
        db.notifs = db.notifs.filter(x => x.from !== n && x.to !== n && !gone.has(x.postId));
        delete db.users[n.toLowerCase()]; delete db.attempts[n.toLowerCase()];
        save();
      },
      // vue stream : ouvre la session d'un VRAI compte « Streamer » (créé au besoin, mot de passe aléatoire jamais conservé)
      async ensureStreamer() {
        const pass = await hashPw(randHex(24));
        const u = load().users[RESERVED];
        if (u) { need(u.admin, 'Compte Streamer invalide'); return u.name; }
        db.users[RESERVED] = { name: 'Streamer', pass, bio: 'Compte du stream 🔴', following: [], joined: now(), admin: true, display: 'Streamer', avatar: '#9146ff', banner: 'grad:0' };
        save(); return 'Streamer';
      },
      post(author, text, replyTo) {
        text = (text || '').trim();
        need(text && text.length <= 280, 'Message vide ou > 280 caractères');
        user(author);
        if (replyTo) need(db.posts.find(p => p.id === replyTo), 'Post introuvable');
        const p = { id: id(), author: user(author).name, text, at: now(), likes: [], replyTo: replyTo || null };
        db.posts.push(p);
        if (replyTo) notify(db.posts.find(x => x.id === replyTo).author, p.author, 'reply', p.id);
        for (const m of text.match(/@\w+/g) || []) { const t = db.users[m.slice(1).toLowerCase()]; if (t) notify(t.name, p.author, 'mention', p.id); }
        save(); return p;
      },
      deletePost(by, postId) {
        const p = db.posts.find(x => x.id === postId);
        need(p && (p.author === by || (db.users[by.toLowerCase()] || {}).admin), 'Suppression interdite');
        db.posts = db.posts.filter(x => x.id !== postId && x.replyTo !== postId);
        save();
      },
      toggleLike(by, postId) {
        const p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable'); user(by);
        const i = p.likes.indexOf(by);
        if (i >= 0) p.likes.splice(i, 1); else { p.likes.push(by); notify(p.author, by, 'like', postId); }
        save(); return p.likes.length;
      },
      toggleFollow(by, target) {
        const me = user(by), t = user(target);
        need(me !== t, 'Impossible de se suivre soi-même');
        const i = me.following.indexOf(t.name);
        if (i >= 0) me.following.splice(i, 1); else { me.following.push(t.name); notify(t.name, me.name, 'follow'); }
        save(); return i < 0;
      },
      // fil : posts racines des gens suivis + les siens, récents d'abord
      feed(by) {
        const me = user(by);
        return db.posts.filter(p => !p.replyTo && (p.author === me.name || me.following.includes(p.author))).sort((a, b) => b.id - a.id);
      },
      explore: () => db.posts.filter(p => !p.replyTo).sort((a, b) => b.id - a.id),
      replies: postId => db.posts.filter(p => p.replyTo === postId).sort((a, b) => a.id - b.id),
      byUser: n => db.posts.filter(p => !p.replyTo && p.author.toLowerCase() === n.toLowerCase()).sort((a, b) => b.id - a.id),
      search(q) {
        q = (q || '').trim().toLowerCase(); if (!q) return { users: [], posts: [] };
        return {
          users: Object.values(db.users).filter(u => u.name.toLowerCase().includes(q)),
          posts: db.posts.filter(p => p.text.toLowerCase().includes(q)).sort((a, b) => b.id - a.id),
        };
      },
      trending() {
        const c = {};
        for (const p of db.posts) for (const t of p.text.match(/#\w+/g) || []) c[t.toLowerCase()] = (c[t.toLowerCase()] || 0) + 1;
        return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
      },
      // score d'un post : likes + réponses, pondérés par la fraîcheur (demi-vie ~3 h)
      score: p => scoreOf(p),
      // classement des posts « en tendance », meilleur score d'abord
      ranking(limit) {
        return db.posts.filter(p => !p.replyTo).map(p => ({ post: p, score: scoreOf(p) })).sort((a, b) => b.score - a.score).slice(0, limit || 5);
      },
      // hashtags du moment : score = somme des scores des posts qui les contiennent
      trendingLive(limit) {
        const c = {};
        for (const p of db.posts) for (const t of new Set((p.text.match(/#\w+/g) || []).map(x => x.toLowerCase()))) { const e = c[t] || (c[t] = { tag: t, count: 0, score: 0 }); e.count++; e.score += scoreOf(p); }
        return Object.values(c).sort((a, b) => b.score - a.score).slice(0, limit || 8);
      },
      // profil éditable : pseudo affiché, bio, couleur d'avatar, bannière (URL d'image ou dégradé), lien web
      updateProfile(by, f) {
        const u = user(by); f = f || {};
        const display = (f.display || '').trim(), bio = (f.bio || '').trim(), avatar = (f.avatar || '').trim(), banner = (f.banner || '').trim(), link = (f.link || '').trim();
        need(display.length <= 30, 'Pseudo affiché : 30 caractères max');
        need(bio.length <= 160, 'Bio : 160 caractères max');
        need(!avatar || /^#[0-9a-fA-F]{6}$/.test(avatar), 'Couleur d’avatar invalide (#rrggbb)');
        need(!banner || /^https?:\/\/\S+$/i.test(banner) || /^grad:[0-5]$/.test(banner), 'Bannière : URL http(s) ou dégradé');
        need(!link || /^https?:\/\/\S+$/i.test(link), 'Lien : URL http(s) requise');
        Object.assign(u, { display, bio, avatar, banner, link });
        save(); return u;
      },
      followers: n => Object.values(db.users).filter(u => u.following.includes(user(n).name)).map(u => u.name),
      profile: n => user(n),
      isAdmin: n => !!(db.users[(n || '').toLowerCase()] || {}).admin,
      // export JSON des données de l'utilisateur (jamais le mot de passe)
      exportUser(by) {
        const u = user(by);
        return { format: 'twitchgram-export', version: 1, exportedAt: now(),
          profile: { name: u.name, display: u.display || '', bio: u.bio || '', avatar: u.avatar || '', banner: u.banner || '', link: u.link || '', following: u.following.slice() },
          posts: db.posts.filter(p => p.author === u.name).map(p => ({ text: p.text, at: p.at, replyTo: p.replyTo })),
          messages: db.messages.filter(m => m.from === u.name || m.to === u.name).map(m => ({ from: m.from, to: m.to, text: m.text, at: m.at })) };
      },
      // import : fusionne profil, abonnements, posts et messages (sans doublons) dans le compte courant
      importUser(by, data) {
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { throw new Error('Fichier JSON invalide'); } }
        need(data && data.format === 'twitchgram-export' && data.profile && Array.isArray(data.posts), 'Ce fichier n’est pas un export TwitchGram');
        const pr = data.profile, r = { posts: 0, messages: 0, following: 0 };
        api.updateProfile(user(by).name, pr); // relit le storage : on reprend l'objet utilisateur après
        const u = user(by);
        for (const f of Array.isArray(pr.following) ? pr.following : []) {
          const t = db.users[String(f).toLowerCase()];
          if (t && t.name !== u.name && !u.following.includes(t.name)) { u.following.push(t.name); r.following++; }
        }
        for (const p of data.posts) {
          const text = String(p.text || '').trim();
          if (!text || text.length > 280 || p.replyTo || db.posts.some(x => x.author === u.name && x.text === text && x.at === p.at)) continue;
          db.posts.push({ id: id(), author: u.name, text, at: +p.at || now(), likes: [], replyTo: null }); r.posts++;
        }
        for (const m of Array.isArray(data.messages) ? data.messages : []) {
          const text = String(m.text || '').trim(), from = db.users[String(m.from).toLowerCase()], to = db.users[String(m.to).toLowerCase()];
          if (!text || text.length > 500 || !from || !to || (from.name !== u.name && to.name !== u.name)) continue;
          if (db.messages.some(x => x.from === from.name && x.to === to.name && x.text === text && x.at === m.at)) continue;
          db.messages.push({ id: id(), from: from.name, to: to.name, text, at: +m.at || now() }); r.messages++;
        }
        save(); return r;
      },
      send(from, to, text) {
        text = (text || '').trim(); need(text && text.length <= 500, 'Message invalide');
        user(from); const t = user(to);
        db.messages.push({ id: id(), from: user(from).name, to: t.name, text, at: now() });
        save();
      },
      conversation(a, b) {
        a = a.toLowerCase(); b = b.toLowerCase();
        return db.messages.filter(m => [m.from.toLowerCase(), m.to.toLowerCase()].sort().join() === [a, b].sort().join());
      },
      notifications(by, markRead) {
        const l = db.notifs.filter(n => n.to === user(by).name).sort((a, b) => b.id - a.id);
        if (markRead) { l.forEach(n => (n.read = true)); save(); }
        return l;
      },
    };
    // chaque méthode relit d'abord le storage partagé (jamais de cache périmé)
    for (const k of Object.keys(api)) { const f = api[k]; api[k] = function () { load(); return f.apply(api, arguments); }; }
    load();
    return api;
  }

  const exported = { Net, KEY };
  if (typeof module !== 'undefined') module.exports = exported; else root.Social = exported;
})(this);
