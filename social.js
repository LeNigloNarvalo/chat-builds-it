// Moteur du réseau social : tout est stocké via un « storage » injecté (localStorage ou mémoire).
(function (root) {
  const KEY = 'twitchgram.v1';
  const empty = () => ({ users: {}, posts: [], messages: [], notifs: [], seq: 1 });

  function hash(s) { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); }

  function Net(storage, now) {
    now = now || Date.now;
    let db;
    try { db = JSON.parse(storage.getItem(KEY)) || empty(); } catch (e) { db = empty(); }
    const save = () => storage.setItem(KEY, JSON.stringify(db));
    const id = () => db.seq++;
    const need = (c, m) => { if (!c) throw new Error(m); };
    const user = n => { const u = db.users[(n || '').toLowerCase()]; need(u, 'Utilisateur introuvable'); return u; };
    const notify = (to, from, type, postId) => {
      if (to === from) return;
      db.notifs.push({ id: id(), to, from, type, postId: postId || null, at: now(), read: false });
    };

    return {
      db: () => db,
      signup(name, password, bio) {
        name = (name || '').trim();
        need(/^[a-zA-Z0-9_]{3,20}$/.test(name), 'Pseudo : 3-20 caractères (lettres, chiffres, _)');
        need((password || '').length >= 4, 'Mot de passe trop court (4 min)');
        need(!db.users[name.toLowerCase()], 'Pseudo déjà pris');
        db.users[name.toLowerCase()] = { name, pass: hash(password), bio: (bio || '').slice(0, 160), following: [], joined: now() };
        save(); return name;
      },
      login(name, password) {
        const u = db.users[(name || '').toLowerCase()];
        need(u && u.pass === hash(password || ''), 'Identifiants invalides');
        return u.name;
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
        need(p && p.author === by, 'Suppression interdite');
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
      followers: n => Object.values(db.users).filter(u => u.following.includes(user(n).name)).map(u => u.name),
      profile: n => user(n),
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
  }

  const api = { Net, KEY };
  if (typeof module !== 'undefined') module.exports = api; else root.Social = api;
})(this);
