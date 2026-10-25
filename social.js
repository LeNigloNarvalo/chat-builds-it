// Moteur de Cornichon : les données sont PARTAGÉES via un « storage » injecté (localStorage).
// Chaque appel relit le storage (lecture-modification-écriture) : aucune copie ancienne n'est conservée en mémoire.
(function (root) {
  const KEY = 'twitchgram.v1';
  const empty = () => ({ users: Object.create(null), posts: [], messages: [], notifs: [], reposts: [], reports: [], seq: 1, attempts: Object.create(null) });
  const MAX_FAILS = 5, LOCK_MS = 60000, EDIT_MS = 15 * 60000;

  const RESERVED = 'streamer';
  // signalements : motifs, sanctions de modération (durée de suspension en heures)
  const REASONS = { spam: 'Spam ou publicité', harcelement: 'Harcèlement', haine: 'Haine ou discrimination', violence: 'Violence ou menace', nsfw: 'Contenu inapproprié', autre: 'Autre' };
  const ACTIONS = ['dismiss', 'delete', 'warn', 'suspend', 'ban'];
  // images jointes : jusqu'à 4 par post/message, en data URL (redimensionnées côté navigateur), avec texte alternatif
  const MAX_IMAGES = 4, MAX_IMG_CHARS = 400000, IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  function cleanImages(list) {
    list = list == null ? [] : list;
    if (!Array.isArray(list)) throw new Error('Images invalides');
    if (list.length > MAX_IMAGES) throw new Error('4 images maximum');
    return list.map(i => {
      const src = String((i && i.src) || '');
      if (!IMG_RE.test(src)) throw new Error('Image invalide (JPEG, PNG, WebP ou GIF)');
      if (src.length > MAX_IMG_CHARS) throw new Error('Image trop lourde');
      return { src, alt: String((i && i.alt) || '').trim().slice(0, 200) };
    });
  }
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
      // dictionnaires sans prototype : un pseudo comme « constructor » ou « __proto__ » reste une simple clé
      db.users = Object.assign(Object.create(null), db.users); db.attempts = Object.assign(Object.create(null), db.attempts);
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

    const lc = n => String(n || '').toLowerCase();
    const has = (list, n) => (list || []).some(x => lc(x) === lc(n));
    // masqué pour `by` : compte bloqué ou masqué par lui (ses posts, réponses et DM disparaissent)
    const hiddenFor = (by, author) => { const u = db.users[lc(by)]; return !!(u && author && lc(author) !== lc(by) && (has(u.blocked, author) || has(u.muted, author))); };
    const guard = n => {
      const s = user(n).sanction; if (!s) return;
      need(s.type !== 'ban', 'Votre compte est banni : action impossible');
      need(!(s.type === 'suspend' && s.until > now()), `Compte suspendu pendant encore ${Math.ceil((s.until - now()) / 60000)} min`);
    };
    const blockedBy = (author, target) => has((db.users[lc(target)] || {}).blocked, author);
    const vis = (by, list, get) => by ? list.filter(x => !hiddenFor(by, get(x))) : list;
    const scoreOf = p => { const h = Math.max(0, now() - p.at) / 36e5; return (1 + p.likes.length * 2 + db.posts.filter(r => r.replyTo === p.id).length * 3) * Math.pow(0.5, h / 3); };

    const api = {
      db: () => db,
      async signup(name, password, bio) {
        name = String(name || '').trim();
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
      // ---- e-mail vérifié : « emailPending » attend la confirmation par lien, « email » est vérifié (unique, jamais public) ----
      emailOk: e => /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(e) && e.length <= 120,
      setEmail(name, email) {
        email = String(email || '').trim().toLowerCase();
        need(api.emailOk(email), 'Adresse e-mail invalide');
        load(); const u = user(name);
        need(!Object.values(db.users).some(x => x !== u && x.email === email), 'Cette adresse est déjà utilisée');
        if (u.email === email) { delete u.emailPending; save(); return { email, verified: true }; }
        u.emailPending = email; save(); return { email, verified: false };
      },
      removeEmail(name) { load(); const u = user(name); delete u.email; delete u.emailPending; save(); },
      // confirmation : n'aboutit que si l'adresse en attente est toujours celle du lien
      confirmEmail(name, email) {
        load(); const u = user(name);
        need(u.emailPending && u.emailPending === email, 'Lien périmé : demandez une nouvelle confirmation');
        need(!Object.values(db.users).some(x => x !== u && x.email === email), 'Cette adresse est déjà utilisée');
        u.email = email; delete u.emailPending; save(); return u.name;
      },
      // seuls les e-mails VÉRIFIÉS permettent la récupération ; accepte un pseudo ou une adresse
      findRecoverable(id) {
        id = String(id || '').trim().toLowerCase(); load();
        const u = db.users[id] || Object.values(db.users).find(x => x.email === id);
        return u && u.email && !u.admin ? { name: u.name, email: u.email } : null;
      },
      // réinitialisation par lien : nouveau mot de passe, sessions révoquées (époque), verrou d'essais levé
      async resetPassword(name, newPw) {
        need((newPw || '').length >= 4, 'Nouveau mot de passe trop court (4 min)');
        const pass = await hashPw(newPw);
        load(); const u = user(name);
        u.pass = pass; u.epoch = (u.epoch || 0) + 1; delete db.attempts[u.name.toLowerCase()];
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
        db.reposts = db.reposts.filter(r => r.by !== n && !gone.has(r.postId));
        db.reports = db.reports.filter(r => r.by !== n && r.target !== n);
        for (const x of Object.values(db.users)) { if (x.blocked) x.blocked = x.blocked.filter(f => f !== n); if (x.muted) x.muted = x.muted.filter(f => f !== n); }
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
      post(author, text, replyTo, images) {
        text = (text || '').trim(); images = cleanImages(images);
        need((text || images.length) && text.length <= 280, 'Message vide ou > 280 caractères');
        user(author); guard(author);
        if (replyTo) { const tp = db.posts.find(p => p.id === replyTo); need(tp, 'Post introuvable'); need(!blockedBy(author, tp.author), 'Cet utilisateur vous a bloqué : réponse impossible'); }
        const p = { id: id(), author: user(author).name, text, at: now(), likes: [], replyTo: replyTo || null };
        if (images.length) p.images = images;
        db.posts.push(p);
        if (replyTo) notify(db.posts.find(x => x.id === replyTo).author, p.author, 'reply', p.id);
        for (const m of text.match(/@\w+/g) || []) { const t = db.users[m.slice(1).toLowerCase()]; if (t) notify(t.name, p.author, 'mention', p.id); }
        save(); return p;
      },
      deletePost(by, postId) {
        const p = db.posts.find(x => x.id === postId);
        need(p && (p.author === by || (db.users[by.toLowerCase()] || {}).admin), 'Suppression interdite');
        const gone = new Set([postId, ...db.posts.filter(x => x.replyTo === postId).map(x => x.id)]);
        db.posts = db.posts.filter(x => !gone.has(x.id));
        db.reposts = db.reposts.filter(r => !gone.has(r.postId));
        for (const u of Object.values(db.users)) if (u.bookmarks) u.bookmarks = u.bookmarks.filter(i => !gone.has(i));
        save();
      },
      // modification : auteur seulement, dans les 15 min ; l'ancien texte part dans l'historique
      editPost(by, postId, text) {
        const p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable');
        need(p.author === user(by).name, 'Vous ne pouvez modifier que vos posts'); guard(by);
        need(now() - p.at <= EDIT_MS, 'Modification impossible après 15 minutes');
        text = (text || '').trim();
        need(text && text.length <= 280, 'Message vide ou > 280 caractères');
        need(text !== p.text, 'Aucun changement');
        (p.history = p.history || []).push({ text: p.text, at: p.editedAt || p.at });
        p.text = text; p.editedAt = now();
        save(); return p;
      },
      canEdit: (by, postId) => { const p = db.posts.find(x => x.id === postId); return !!(p && by && p.author.toLowerCase() === by.toLowerCase() && now() - p.at <= EDIT_MS); },
      editLeft: postId => { const p = db.posts.find(x => x.id === postId); return p ? Math.max(0, p.at + EDIT_MS - now()) : 0; },
      // favoris : liste personnelle (stockée sur le compte, partagée via le storage)
      toggleBookmark(by, postId) {
        const u = user(by); need(db.posts.find(x => x.id === postId), 'Post introuvable');
        const b = u.bookmarks = u.bookmarks || [], i = b.indexOf(postId);
        if (i >= 0) b.splice(i, 1); else b.push(postId);
        save(); return i < 0;
      },
      isBookmarked: (by, postId) => !!(((db.users[(by || '').toLowerCase()] || {}).bookmarks || []).includes(postId)),
      bookmarks: by => (user(by).bookmarks || []).slice().reverse().map(i => db.posts.find(p => p.id === i)).filter(p => p && !hiddenFor(by, p.author)),
      // repartage sur son profil (posts racines des autres uniquement)
      toggleRepost(by, postId) {
        const me = user(by), p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable');
        need(!p.replyTo, 'Seuls les posts peuvent être repartagés');
        need(p.author !== me.name, 'Impossible de repartager son propre post'); guard(by);
        const i = db.reposts.findIndex(r => r.by === me.name && r.postId === postId);
        if (i >= 0) db.reposts.splice(i, 1); else { db.reposts.push({ id: id(), by: me.name, postId, at: now() }); notify(p.author, me.name, 'repost', postId); }
        save(); return i < 0;
      },
      repostCount: postId => db.reposts.filter(r => r.postId === postId).length,
      hasReposted: (by, postId) => db.reposts.some(r => r.by.toLowerCase() === (by || '').toLowerCase() && r.postId === postId),
      // profil : posts + repartages, récents d'abord
      timeline(n, by) {
        const own = db.posts.filter(p => !p.replyTo && p.author.toLowerCase() === n.toLowerCase()).map(p => ({ post: p, at: p.at, by: null }));
        const rt = db.reposts.filter(r => r.by.toLowerCase() === n.toLowerCase()).map(r => ({ post: db.posts.find(p => p.id === r.postId), at: r.at, by: r.by })).filter(x => x.post);
        return vis(by, own.concat(rt), x => x.post.author).filter(x => !x.by || !hiddenFor(by, x.by)).sort((a, b) => b.at - a.at);
      },
      toggleLike(by, postId) {
        const p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable'); user(by); guard(by);
        const i = p.likes.indexOf(by);
        if (i >= 0) p.likes.splice(i, 1); else { p.likes.push(by); notify(p.author, by, 'like', postId); }
        save(); return p.likes.length;
      },
      toggleFollow(by, target) {
        const me = user(by), t = user(target);
        need(me !== t, 'Impossible de se suivre soi-même'); guard(by);
        if (!has(me.following, t.name)) need(!blockedBy(me.name, t.name) && !has(me.blocked, t.name), 'Abonnement impossible (compte bloqué)');
        const i = me.following.indexOf(t.name);
        if (i >= 0) me.following.splice(i, 1); else { me.following.push(t.name); notify(t.name, me.name, 'follow'); }
        save(); return i < 0;
      },
      // fil : posts racines des gens suivis + les siens, récents d'abord
      feed(by) {
        const me = user(by);
        return db.posts.filter(p => !p.replyTo && !hiddenFor(by, p.author) && (p.author === me.name || me.following.includes(p.author))).sort((a, b) => b.id - a.id);
      },
      explore: by => vis(by, db.posts.filter(p => !p.replyTo), p => p.author).sort((a, b) => b.id - a.id),
      replies: (postId, by) => vis(by, db.posts.filter(p => p.replyTo === postId), p => p.author).sort((a, b) => a.id - b.id),
      byUser: (n, by) => vis(by, db.posts.filter(p => !p.replyTo && p.author.toLowerCase() === n.toLowerCase()), p => p.author).sort((a, b) => b.id - a.id),
      search(q, by) {
        q = (q || '').trim().toLowerCase(); if (!q) return { users: [], posts: [] };
        return {
          users: vis(by, Object.values(db.users).filter(u => u.name.toLowerCase().includes(q)), u => u.name),
          posts: vis(by, db.posts.filter(p => p.text.toLowerCase().includes(q)), p => p.author).sort((a, b) => b.id - a.id),
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
      ranking(limit, by) {
        return vis(by, db.posts.filter(p => !p.replyTo), p => p.author).map(p => ({ post: p, score: scoreOf(p) })).sort((a, b) => b.score - a.score).slice(0, limit || 5);
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
        return { format: 'cornichon-export', version: 1, exportedAt: now(),
          profile: { name: u.name, display: u.display || '', bio: u.bio || '', avatar: u.avatar || '', banner: u.banner || '', link: u.link || '', following: u.following.slice() },
          posts: db.posts.filter(p => p.author === u.name).map(p => ({ text: p.text, at: p.at, replyTo: p.replyTo, images: p.images || [] })),
          messages: db.messages.filter(m => m.from === u.name || m.to === u.name).map(m => ({ from: m.from, to: m.to, text: m.text, at: m.at, images: m.images || [] })) };
      },
      // import : fusionne profil, abonnements, posts et messages (sans doublons) dans le compte courant
      importUser(by, data) {
        if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { throw new Error('Fichier JSON invalide'); } }
        need(data && (data.format === 'cornichon-export' || data.format === 'twitchgram-export') && data.profile && Array.isArray(data.posts), 'Ce fichier n’est pas un export Cornichon');
        const pr = data.profile, r = { posts: 0, messages: 0, following: 0 };
        api.updateProfile(user(by).name, pr); // relit le storage : on reprend l'objet utilisateur après
        const u = user(by);
        for (const f of Array.isArray(pr.following) ? pr.following : []) {
          const t = db.users[String(f).toLowerCase()];
          if (t && t.name !== u.name && !u.following.includes(t.name)) { u.following.push(t.name); r.following++; }
        }
        for (const p of data.posts) {
          const text = String(p.text || '').trim();
          let imgs; try { imgs = cleanImages(p.images); } catch (e) { continue; }
          if ((!text && !imgs.length) || text.length > 280 || p.replyTo || db.posts.some(x => x.author === u.name && x.text === text && x.at === p.at)) continue;
          const np = { id: id(), author: u.name, text, at: +p.at || now(), likes: [], replyTo: null }; if (imgs.length) np.images = imgs; db.posts.push(np); r.posts++;
        }
        for (const m of Array.isArray(data.messages) ? data.messages : []) {
          let imgs; try { imgs = cleanImages(m.images); } catch (e) { continue; }
          const text = String(m.text || '').trim(), from = db.users[String(m.from).toLowerCase()], to = db.users[String(m.to).toLowerCase()];
          if ((!text && !imgs.length) || text.length > 500 || !from || !to || (from.name !== u.name && to.name !== u.name)) continue;
          if (db.messages.some(x => x.from === from.name && x.to === to.name && x.text === text && x.at === m.at)) continue;
          const nm = { id: id(), from: from.name, to: to.name, text, at: +m.at || now() }; if (imgs.length) nm.images = imgs; db.messages.push(nm); r.messages++;
        }
        save(); return r;
      },
      send(from, to, text, images) {
        text = (text || '').trim(); images = cleanImages(images);
        need((text || images.length) && text.length <= 500, 'Message invalide');
        user(from); guard(from); const t = user(to);
        need(!blockedBy(from, to), 'Cet utilisateur vous a bloqué : message impossible');
        need(!has(user(from).blocked, to), 'Débloquez cet utilisateur pour lui écrire');
        const m = { id: id(), from: user(from).name, to: t.name, text, at: now() };
        if (images.length) m.images = images;
        db.messages.push(m);
        save();
      },
      // ---- messages non lus : curseur « dernier message lu » par interlocuteur, stocké sur le compte ----
      markDmRead(by, peer) {
        const me = user(by), t = user(peer), k = lc(t.name);
        const last = db.messages.filter(m => m.from === t.name && m.to === me.name).reduce((a, m) => Math.max(a, m.id), 0);
        const r = me.dmRead = me.dmRead || {};
        if ((r[k] || 0) >= last) return false;
        r[k] = last; save(); return true;
      },
      // { total, peers: { pseudo: n } } : messages reçus après le curseur de lecture, hors comptes bloqués/masqués
      unreadDm(by) {
        const me = user(by), r = me.dmRead || {}, peers = {}; let total = 0;
        for (const m of db.messages) if (m.to === me.name && m.id > (r[lc(m.from)] || 0) && !hiddenFor(by, m.from)) { peers[m.from] = (peers[m.from] || 0) + 1; total++; }
        return { total, peers };
      },
      // pagination par curseur (id décroissant) : scope « feed » (abonnements) ou « explore » ; `after` compte les posts plus récents
      page(by, scope, o) {
        o = o || {};
        const all = scope === 'feed' ? api.feed(by) : api.explore(by), limit = Math.min(50, Math.max(1, +o.limit || 10));
        if (o.after) return { count: all.filter(p => p.id > +o.after).length };
        const rest = o.before ? all.filter(p => p.id < +o.before) : all;
        return { posts: rest.slice(0, limit), more: rest.length > limit, total: all.length };
      },
      conversation(a, b) {
        if (hiddenFor(a, b)) return [];
        a = a.toLowerCase(); b = b.toLowerCase();
        return db.messages.filter(m => [m.from.toLowerCase(), m.to.toLowerCase()].sort().join() === [a, b].sort().join());
      },
      // ---- blocage / masquage (listes personnelles stockées sur le compte) ----
      // bloquer : masque tout + coupe les abonnements dans les deux sens + interdit réponses, DM et abonnement
      toggleBlock(by, target) {
        const me = user(by), t = user(target);
        need(me !== t, 'Impossible de se bloquer soi-même'); need(!t.admin, 'Le compte Streamer ne peut pas être bloqué');
        const b = me.blocked = me.blocked || [], i = b.findIndex(x => lc(x) === lc(t.name));
        if (i >= 0) b.splice(i, 1);
        else { b.push(t.name); me.following = me.following.filter(f => f !== t.name); t.following = t.following.filter(f => f !== me.name); }
        save(); return i < 0;
      },
      // masquer : tout disparaît du fil sans prévenir la personne, qui peut toujours écrire
      toggleMute(by, target) {
        const me = user(by), t = user(target);
        need(me !== t, 'Impossible de se masquer soi-même'); need(!t.admin, 'Le compte Streamer ne peut pas être masqué');
        const m = me.muted = me.muted || [], i = m.findIndex(x => lc(x) === lc(t.name));
        if (i >= 0) m.splice(i, 1); else m.push(t.name);
        save(); return i < 0;
      },
      isBlocked: (by, n) => has((db.users[lc(by)] || {}).blocked, n),
      isMuted: (by, n) => has((db.users[lc(by)] || {}).muted, n),
      isHidden: (by, n) => hiddenFor(by, n),
      blockedList: by => (user(by).blocked || []).filter(n => db.users[lc(n)]).slice(),
      mutedList: by => (user(by).muted || []).filter(n => db.users[lc(n)]).slice(),
      // ---- signalements ----
      reasons: () => Object.assign({}, REASONS),
      report(by, postId, reason, note) {
        const me = user(by), p = db.posts.find(x => x.id === postId);
        need(p, 'Post introuvable'); need(REASONS[reason], 'Choisissez un motif de signalement');
        need(p.author !== me.name, 'Vous ne pouvez pas signaler votre propre post');
        need(!user(p.author).admin, 'Le compte Streamer ne peut pas être signalé');
        note = (note || '').trim(); need(note.length <= 300, 'Précisions : 300 caractères max');
        need(!db.reports.some(r => r.postId === postId && r.by === me.name && r.status === 'open'), 'Vous avez déjà signalé ce post');
        const r = { id: id(), postId, by: me.name, target: p.author, reason, note, at: now(), status: 'open', snap: { text: p.text, images: (p.images || []).length, replyTo: p.replyTo } };
        db.reports.push(r); save(); return r;
      },
      hasReported: (by, postId) => db.reports.some(r => r.postId === postId && lc(r.by) === lc(by) && r.status === 'open'),
      // file de modération (admin) : signalements ouverts regroupés par post, les plus signalés d'abord
      queue(by) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        const g = {};
        for (const r of db.reports.filter(x => x.status === 'open')) { const e = g[r.postId] || (g[r.postId] = { postId: r.postId, target: r.target, snap: r.snap, reports: [], last: 0 }); e.reports.push(r); e.last = Math.max(e.last, r.at); }
        return Object.values(g).sort((a, b) => b.reports.length - a.reports.length || b.last - a.last);
      },
      history(by, limit) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        return db.reports.filter(r => r.status !== 'open').sort((a, b) => b.closedAt - a.closedAt || b.id - a.id).slice(0, limit || 30);
      },
      // décision sur TOUS les signalements ouverts d'un post : dismiss | delete | warn | suspend | ban
      moderate(by, postId, action, opts) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); need(ACTIONS.includes(action), 'Action inconnue');
        opts = opts || {};
        const open = db.reports.filter(r => r.postId === postId && r.status === 'open'); need(open.length, 'Aucun signalement ouvert pour ce post');
        const target = db.users[lc(open[0].target)], hours = Math.min(24 * 90, Math.max(1, +opts.hours || 24));
        if (action !== 'dismiss' && target) need(!target.admin, 'Impossible de sanctionner un administrateur');
        if (target && ['warn', 'suspend', 'ban'].includes(action)) {
          const prev = target.sanction || {};
          target.sanction = { type: action, at: now(), by: user(by).name, reason: REASONS[open[0].reason], warnings: (prev.warnings || 0) + (action === 'warn' ? 1 : 0) };
          if (action === 'suspend') target.sanction.until = now() + hours * 36e5;
          (target.sanctions = target.sanctions || []).push({ type: action, at: now(), reason: REASONS[open[0].reason], hours: action === 'suspend' ? hours : 0, postId });
          notify(target.name, user(by).name, 'sanction', null);
        }
        for (const r of open) Object.assign(r, { status: action === 'dismiss' ? 'dismissed' : 'actioned', action, closedAt: now(), closedBy: user(by).name });
        save();
        if (action === 'delete') api.deletePost(by, postId); // relit le storage : à faire après l'enregistrement
        return open.length;
      },
      // sanction active d'un compte (null si aucune ou expirée) ; l'admin peut la lever
      sanctionOf(n) { const s = (db.users[lc(n)] || {}).sanction; if (!s) return null; if (s.type === 'suspend' && s.until <= now()) return null; return s; },
      liftSanction(by, n) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); const u = user(n); need(u.sanction, 'Aucune sanction active');
        delete u.sanction; save();
      },
      sanctioned: by => { need(api.isAdmin(by), 'Réservé à l’administrateur'); return Object.values(db.users).filter(u => u.sanction && (u.sanction.type !== 'suspend' || u.sanction.until > now())).map(u => ({ name: u.name, sanction: u.sanction })); },
      notifications(by, markRead) {
        const l = db.notifs.filter(n => n.to === user(by).name && !hiddenFor(by, n.from)).sort((a, b) => b.id - a.id);
        if (markRead) { l.forEach(n => (n.read = true)); save(); }
        return l;
      },
    };
    // chaque méthode relit d'abord le storage partagé (jamais de cache périmé)
    for (const k of Object.keys(api)) { const f = api[k]; api[k] = function () { load(); return f.apply(api, arguments); }; }
    load();
    return api;
  }

  // Vue d'un compte sur les données (envoyée par le serveur) : jamais de mot de passe, d'époque de session,
  // de messages ou notifications d'autrui, ni de listes privées (favoris, blocages, sanctions) des autres comptes.
  function snapshot(db, by) {
    const me = db.users[String(by || '').toLowerCase()];
    if (!me) throw new Error('Utilisateur introuvable');
    const lcm = me.name.toLowerCase(), users = Object.create(null);
    for (const [k, u] of Object.entries(db.users)) {
      const { pass, epoch, blocked, muted, bookmarks, sanction, sanctions, dmRead, email, emailPending, ...pub } = u;
      if (k === lcm) Object.assign(pub, { blocked, muted, bookmarks, sanction, sanctions, dmRead, email, emailPending });
      else if (me.admin) Object.assign(pub, { sanction });
      users[k] = JSON.parse(JSON.stringify(pub));
    }
    return {
      users, posts: db.posts, reposts: db.reposts, seq: db.seq, attempts: {},
      messages: db.messages.filter(m => m.from === me.name || m.to === me.name),
      notifs: db.notifs.filter(n => n.to === me.name),
      reports: me.admin ? db.reports : db.reports.filter(r => r.by === me.name).map(r => ({ id: r.id, postId: r.postId, by: r.by, status: r.status })),
    };
  }

  const exported = { Net, snapshot, KEY, MAX_IMAGES, cleanImages, REASONS };
  if (typeof module !== 'undefined') module.exports = exported; else root.Social = exported;
})(this);
