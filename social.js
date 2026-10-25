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
      followers: n => Object.values(db.users).filter(u => u.following.includes(user(n).name)).map(u => u.name),
      profile: n => user(n),
      isAdmin: n => !!(db.users[(n || '').toLowerCase()] || {}).admin,
      // session démo du stream (?stream=1) : compte admin + données d'exemple, idempotent
      seedDemo() {
        if (db.users.admin) return 'Admin';
        const t = now();
        const mk = (name, bio, extra) => (db.users[name.toLowerCase()] = Object.assign({ name, pass: hash('demo'), bio, following: [], joined: t - 864e5 * 30 }, extra));
        mk('Admin', 'Compte de démonstration administrateur 👑', { admin: true });
        mk('Luna', 'Streameuse & fan de pixel art 🎨', {}); mk('Pixel', 'Je code en direct sur Twitch 💻', {}); mk('Neo', 'Open source, café et chat 🐱', {});
        db.users.admin.following = ['Luna', 'Pixel', 'Neo']; db.users.luna.following = ['Admin', 'Pixel']; db.users.pixel.following = ['Admin']; db.users.neo.following = ['Admin', 'Luna'];
        const mkPost = (author, text, mins, likes, replyTo) => { const p = { id: id(), author, text, at: t - mins * 60000, likes, replyTo: replyTo || null }; db.posts.push(p); return p; };
        const a = mkPost('Luna', 'Bienvenue sur TwitchGram ! 🎉 #twitch #opensource', 120, ['Admin', 'Pixel', 'Neo']);
        mkPost('Pixel', 'Ce réseau social a été voté par le chat en direct 🔥 #twitch', 90, ['Admin', 'Luna']);
        const c = mkPost('Neo', 'Qui est là pour le stream de ce soir ? @Admin', 45, ['Luna']);
        mkPost('Admin', 'En tant qu’admin, je peux modérer tous les posts 👑 #admin', 30, ['Luna', 'Neo']);
        mkPost('Luna', 'Merci le chat, vous êtes incroyables ! #opensource', 15, ['Admin']);
        mkPost('Pixel', 'Bravo, super idée !', 100, ['Luna'], a.id);
        mkPost('Admin', 'Oui, on est là ! 🙌', 40, [], c.id);
        db.messages.push({ id: id(), from: 'Luna', to: 'Admin', text: 'Salut ! Prêt pour le live ?', at: t - 600000 }, { id: id(), from: 'Admin', to: 'Luna', text: 'Toujours 😎', at: t - 540000 });
        db.notifs.push({ id: id(), to: 'Admin', from: 'Luna', type: 'like', postId: db.posts[3].id, at: t - 300000, read: false }, { id: id(), to: 'Admin', from: 'Neo', type: 'mention', postId: c.id, at: t - 2700000, read: false }, { id: id(), to: 'Admin', from: 'Pixel', type: 'follow', postId: null, at: t - 3600000, read: false });
        save(); return 'Admin';
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
  }

  const api = { Net, KEY };
  if (typeof module !== 'undefined') module.exports = api; else root.Social = api;
})(this);
