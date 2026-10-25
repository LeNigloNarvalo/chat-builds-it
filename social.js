// Moteur de Cornichon : les données sont PARTAGÉES via un « storage » injecté (localStorage).
// Chaque appel relit le storage (lecture-modification-écriture) : aucune copie ancienne n'est conservée en mémoire.
(function (root) {
  const KEY = 'twitchgram.v1';
  const empty = () => ({ users: Object.create(null), posts: [], messages: [], notifs: [], reposts: [], reports: [], appeals: [], drafts: [], groups: [], audit: [], seq: 1, attempts: Object.create(null) });
  const MAX_FAILS = 5, LOCK_MS = 60000, EDIT_MS = 15 * 60000, MAX_DRAFTS = 30, MAX_LISTS = 20, MAX_LIST_MEMBERS = 200, MAX_AHEAD_MS = 366 * 86400000, POLL_MAX_MIN = 7 * 1440, MAX_OWN_GROUPS = 10, MAX_RULES = 600;

  const RESERVED = 'streamer';
  // signalements : motifs, sanctions de modération (durée de suspension en heures)
  const REASONS = { spam: 'Spam ou publicité', harcelement: 'Harcèlement', haine: 'Haine ou discrimination', violence: 'Violence ou menace', nsfw: 'Contenu inapproprié', autre: 'Autre' };
  const SANC_TXT = { warn: 'Avertissement', suspend: 'Suspension', ban: 'Bannissement' };
  const ACTIONS = ['dismiss', 'hide', 'delete', 'warn', 'suspend', 'ban'];
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
    const notify = (to, from, type, postId, extra) => {
      if (to === from) return;
      db.notifs.push(Object.assign({ id: id(), to, from, type, postId: postId || null, at: now(), read: false }, extra));
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
    // journal d'audit des actions de modération (visible des seuls administrateurs)
    const audit = (by, type, target, detail) => { db.audit = db.audit || []; db.audit.push({ id: id(), at: now(), by: user(by).name, type, target: target || null, detail: detail || '' }); if (db.audit.length > 2000) db.audit = db.audit.slice(-2000); };
    const purge = u => { // supprime un compte avec tout ce qui le concerne
        const n = u.name;
        for (const g of db.groups.filter(x => lc(x.owner) === lc(n))) dropGroup(g); // ses communautés disparaissent avec lui
        for (const g of db.groups) for (const k of ['mods', 'members', 'requests', 'invites', 'banned']) g[k] = g[k].filter(x => lc(x) !== lc(n));
        const gone = new Set(db.posts.filter(p => p.author === n).map(p => p.id));
        db.posts = db.posts.filter(p => !gone.has(p.id) && !gone.has(p.replyTo));
        for (const p of db.posts) { p.likes = p.likes.filter(x => x !== n); for (const e of Object.keys(p.reactions || {})) p.reactions[e] = p.reactions[e].filter(x => x !== n); }
        for (const x of Object.values(db.users)) { x.following = x.following.filter(f => f !== n); for (const l of x.lists || []) l.members = l.members.filter(f => f !== n); }
        db.messages = db.messages.filter(m => m.from !== n && m.to !== n); db.drafts = db.drafts.filter(d => d.author !== n);
        db.reposts = db.reposts.filter(r => r.by !== n && !gone.has(r.postId));
        db.reports = db.reports.filter(r => r.by !== n && r.target !== n); db.appeals = (db.appeals || []).filter(a => a.user !== n);
        for (const x of Object.values(db.users)) { if (x.blocked) x.blocked = x.blocked.filter(f => f !== n); if (x.muted) x.muted = x.muted.filter(f => f !== n); }
        db.notifs = db.notifs.filter(x => x.from !== n && x.to !== n && !gone.has(x.postId));
        delete db.users[n.toLowerCase()]; delete db.attempts[n.toLowerCase()];
    };
    const blockedBy = (author, target) => has((db.users[lc(target)] || {}).blocked, author);
    const vis = (by, list, get) => by ? list.filter(x => !hiddenFor(by, get(x))) : list;
    const scoreOf = p => { const h = Math.max(0, now() - p.at) / 36e5; return (1 + p.likes.length * 2 + db.posts.filter(r => r.replyTo === p.id).length * 3) * Math.pow(0.5, h / 3); };

    // création d'un post (sans sauvegarde) : partagée par la publication directe, les brouillons et la publication planifiée
    // ---- communautés : rôle d'un compte dans un groupe (owner | mod | member | pending | invited | null) ----
    const grp = gid => { const g = db.groups.find(x => x.id === +gid); need(g, 'Communauté introuvable'); return g; };
    const roleIn = (g, n) => !n ? null : lc(g.owner) === lc(n) ? 'owner' : has(g.mods, n) ? 'mod' : has(g.members, n) ? 'member' : has(g.requests, n) ? 'pending' : has(g.invites, n) ? 'invited' : null;
    const isMember = (g, n) => ['owner', 'mod', 'member'].includes(roleIn(g, n));
    const canMod = (g, n) => ['owner', 'mod'].includes(roleIn(g, n));
    const canRead = (g, n) => g.public || isMember(g, n);
    const needMod = (g, by) => need(canMod(g, user(by).name), 'Réservé aux modérateurs de la communauté');
    const seen = (p, n) => { if (!p || !p.group) return true; const g = db.groups.find(x => x.id === p.group); return !!g && canRead(g, n); };
    const dropGroup = g => { // supprime la communauté, ses posts et leurs réponses
      const gone = new Set(db.posts.filter(p => p.group === g.id).map(p => p.id));
      db.posts = db.posts.filter(p => !gone.has(p.id)); db.reposts = db.reposts.filter(r => !gone.has(r.postId));
      for (const u of Object.values(db.users)) if (u.bookmarks) u.bookmarks = u.bookmarks.filter(i => !gone.has(i));
      db.notifs = db.notifs.filter(x => x.group !== g.id && !gone.has(x.postId));
      db.groups = db.groups.filter(x => x !== g);
    };
    const makePost = (author, text, replyTo, images, poll, group) => {
        text = (text || '').trim(); images = cleanImages(images);
        need((text || images.length) && text.length <= 280, 'Message vide ou > 280 caractères');
        user(author); guard(author);
        let gid = group ? +group : null;
        if (replyTo) { const tp = db.posts.find(p => p.id === replyTo); need(tp, 'Post introuvable'); need(!blockedBy(author, tp.author), 'Cet utilisateur vous a bloqué : réponse impossible'); if (tp.group) gid = tp.group; }
        let g = null;
        if (gid) { g = grp(gid); need(isMember(g, author), 'Rejoignez la communauté pour y publier'); }
        const p = { id: id(), author: user(author).name, text, at: now(), likes: [], replyTo: replyTo || null };
        if (g) p.group = g.id;
        if (images.length) p.images = images;
        if (poll) {
          need(!replyTo, 'Un sondage ne peut pas être une réponse');
          const opts = (poll.options || []).map(o => String(o || '').trim()).filter(Boolean);
          need(opts.length >= 2 && opts.length <= 4, 'Un sondage a 2 à 4 choix');
          need(opts.every(o => o.length <= 60), 'Choix limités à 60 caractères');
          need(new Set(opts.map(lc)).size === opts.length, 'Les choix doivent être différents');
          const min = +poll.minutes; need(Number.isFinite(min) && min >= 1 && min <= POLL_MAX_MIN, 'Durée du sondage : 1 minute à 7 jours');
          p.poll = { options: opts.map(text => ({ text, votes: [] })), endsAt: now() + Math.round(min * 60000), closed: false };
        }
        db.posts.push(p);
        const seeable = n => !g || isMember(g, n);
        if (replyTo) { const to = db.posts.find(x => x.id === replyTo).author; if (seeable(to)) notify(to, p.author, 'reply', p.id); }
        for (const m of new Set((text.match(/@\w+/g) || []).map(lc))) { const t = db.users[m.slice(1).toLowerCase()]; if (t && seeable(t.name)) notify(t.name, p.author, 'mention', p.id); }
      return p;
    };

    const ownList = (by, listId) => { const l = (user(by).lists || []).find(x => x.id === +listId); need(l, 'Liste introuvable'); return l; };

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
        load(); u = user(name); purge(u);
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
      post(author, text, replyTo, images, poll, group) { const p = makePost(author, text, replyTo, images, poll, group); save(); return p; },
      // vote unique par compte : le choix est définitif ; refusé une fois le sondage clos
      vote(by, postId, choice) {
        const u = user(by); guard(by);
        const p = db.posts.find(x => x.id === postId); need(p && p.poll && seen(p, by), 'Sondage introuvable');
        need(!p.poll.closed && p.poll.endsAt > now(), 'Ce sondage est clos');
        need(Number.isInteger(choice) && p.poll.options[choice], 'Choix invalide');
        need(!p.poll.options.some(o => o.votes.includes(u.name)), 'Vous avez déjà voté');
        need(!blockedBy(u.name, p.author), 'Cet utilisateur vous a bloqué : vote impossible');
        p.poll.options[choice].votes.push(u.name); save(); return p.poll;
      },
      // clôture les sondages arrivés à échéance et prévient leur auteur (appelée par l'horloge du serveur)
      closePolls() {
        let n = 0;
        for (const p of db.posts) if (p.poll && !p.poll.closed && p.poll.endsAt <= now()) { p.poll.closed = true; notify(p.author, '', 'poll', p.id); n++; }
        if (n) save();
        return n;
      },
      deletePost(by, postId) {
        const p = db.posts.find(x => x.id === postId);
        need(p && (p.author === by || (db.users[by.toLowerCase()] || {}).admin || (p.group && db.groups.some(g => g.id === p.group && canMod(g, by)))), 'Suppression interdite');
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
      // ---- brouillons & publication planifiée : privés à l'auteur, enregistrés automatiquement ----
      // opts.scheduledAt : absent = inchangé, null = retire la planification, nombre = date de publication (ms, dans le futur)
      saveDraft(by, draftId, text, images, opts) {
        const u = user(by); text = String(text || '').trim(); images = cleanImages(images); opts = opts || {};
        need(text.length <= 280, 'Plus de 280 caractères');
        let d = draftId ? db.drafts.find(x => x.id === draftId) : null;
        if (draftId) need(d && d.author === u.name, 'Brouillon introuvable');
        if (!text && !images.length) { if (d) { db.drafts = db.drafts.filter(x => x !== d); save(); } return null; } // brouillon vidé = supprimé
        if (!d) { need(db.drafts.filter(x => x.author === u.name).length < MAX_DRAFTS, `${MAX_DRAFTS} brouillons maximum`); d = { id: id(), author: u.name, text: '', images: [], scheduledAt: null }; db.drafts.push(d); }
        if ('scheduledAt' in opts) {
          const t = opts.scheduledAt;
          if (t === null) d.scheduledAt = null;
          else { need(Number.isFinite(+t) && +t > now(), 'La date de publication doit être dans le futur'); need(+t <= now() + MAX_AHEAD_MS, 'Planification limitée à un an'); need(text || images.length, 'Message vide'); guard(by); d.scheduledAt = Math.round(+t); }
          delete d.failed;
        }
        d.text = text; d.images = images; d.updatedAt = now();
        save(); return d;
      },
      drafts: by => db.drafts.filter(d => d.author.toLowerCase() === lc(by)).sort((a, b) => (a.scheduledAt || Infinity) - (b.scheduledAt || Infinity) || b.updatedAt - a.updatedAt),
      deleteDraft(by, draftId) {
        const d = db.drafts.find(x => x.id === draftId); need(d && d.author === user(by).name, 'Brouillon introuvable');
        db.drafts = db.drafts.filter(x => x !== d); save();
      },
      publishDraft(by, draftId) {
        const d = db.drafts.find(x => x.id === draftId); need(d && d.author === user(by).name, 'Brouillon introuvable');
        const p = makePost(d.author, d.text, null, d.images); db.drafts = db.drafts.filter(x => x !== d); save(); return p;
      },
      // appelée par le serveur (horloge du serveur) : publie les brouillons dont la date est arrivée ; un échec (compte suspendu…) rend le brouillon à son auteur
      publishDue() {
        let n = api.closePolls() ? 1 : 0, changed = false;
        for (const d of db.drafts.slice()) {
          if (!d.scheduledAt || d.scheduledAt > now()) continue;
          try { makePost(d.author, d.text, null, d.images); db.drafts = db.drafts.filter(x => x !== d); n++; }
          catch (e) { d.scheduledAt = null; d.failed = 'Publication planifiée échouée : ' + e.message; changed = true; }
        }
        if (n || changed) save();
        return n;
      },
      // favoris : liste personnelle (stockée sur le compte, partagée via le storage)
      toggleBookmark(by, postId) {
        const u = user(by); need(seen(db.posts.find(x => x.id === postId), by) && db.posts.find(x => x.id === postId), 'Post introuvable');
        const b = u.bookmarks = u.bookmarks || [], i = b.indexOf(postId);
        if (i >= 0) b.splice(i, 1); else b.push(postId);
        save(); return i < 0;
      },
      isBookmarked: (by, postId) => !!(((db.users[(by || '').toLowerCase()] || {}).bookmarks || []).includes(postId)),
      bookmarks: by => (user(by).bookmarks || []).slice().reverse().map(i => db.posts.find(p => p.id === i)).filter(p => p && seen(p, by) && !hiddenFor(by, p.author)),
      // ---- listes de comptes : nommées, privées (visibles par leur auteur seul) ou publiques ; chacune a son propre fil ----
      createList(by, name, isPublic) {
        const u = user(by); guard(by); name = String(name || '').trim().replace(/\s+/g, ' ');
        need(name.length >= 1 && name.length <= 40, 'Nom de liste : 1 à 40 caractères');
        const l = u.lists = u.lists || [];
        need(l.length < MAX_LISTS, `${MAX_LISTS} listes maximum`);
        need(!l.some(x => lc(x.name) === lc(name)), 'Vous avez déjà une liste de ce nom');
        const x = { id: id(), name, public: !!isPublic, members: [], at: now() }; l.push(x); save(); return x;
      },
      updateList(by, listId, o) {
        const l = ownList(by, listId); o = o || {};
        if (o.name !== undefined) {
          const name = String(o.name).trim().replace(/\s+/g, ' '); need(name.length >= 1 && name.length <= 40, 'Nom de liste : 1 à 40 caractères');
          need(!user(by).lists.some(x => x !== l && lc(x.name) === lc(name)), 'Vous avez déjà une liste de ce nom'); l.name = name;
        }
        if (o.public !== undefined) l.public = !!o.public;
        save(); return l;
      },
      deleteList(by, listId) { const l = ownList(by, listId), u = user(by); u.lists = u.lists.filter(x => x !== l); save(); },
      // ajoute/retire un compte (pas besoin de le suivre) ; renvoie true s'il vient d'être ajouté
      toggleListMember(by, listId, target) {
        const l = ownList(by, listId), t = user(target); guard(by);
        const i = l.members.findIndex(m => lc(m) === lc(t.name));
        if (i >= 0) l.members.splice(i, 1); else { need(l.members.length < MAX_LIST_MEMBERS, `${MAX_LIST_MEMBERS} comptes maximum par liste`); l.members.push(t.name); }
        save(); return i < 0;
      },
      // listes d'un compte vues par `by` : toutes les siennes, seulement les publiques pour les autres
      lists: (owner, by) => { const o = db.users[lc(owner)]; return o ? (o.lists || []).filter(l => l.public || lc(o.name) === lc(by)) : []; },
      list(owner, listId, by) { const l = api.lists(owner, by).find(x => x.id === listId); need(l, 'Liste introuvable'); return l; },
      listsWith: (by, target) => (user(by).lists || []).filter(l => has(l.members, target)).map(l => l.id),
      // fil dédié : posts racines des seuls comptes de la liste
      listFeed(by, owner, listId) {
        const l = api.list(owner, listId, by);
        return db.posts.filter(p => !p.replyTo && !p.group && has(l.members, p.author) && !hiddenFor(by, p.author)).sort((a, b) => b.id - a.id);
      },
      // repartage sur son profil (posts racines des autres uniquement)
      toggleRepost(by, postId) {
        const me = user(by), p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable');
        need(!p.replyTo, 'Seuls les posts peuvent être repartagés'); need(!p.group, 'Les posts d’une communauté ne se repartagent pas');
        need(p.author !== me.name, 'Impossible de repartager son propre post'); guard(by);
        const i = db.reposts.findIndex(r => r.by === me.name && r.postId === postId);
        if (i >= 0) db.reposts.splice(i, 1); else { db.reposts.push({ id: id(), by: me.name, postId, at: now() }); notify(p.author, me.name, 'repost', postId); }
        save(); return i < 0;
      },
      repostCount: postId => db.reposts.filter(r => r.postId === postId).length,
      hasReposted: (by, postId) => db.reposts.some(r => r.by.toLowerCase() === (by || '').toLowerCase() && r.postId === postId),
      // profil : posts + repartages, récents d'abord
      timeline(n, by) {
        const own = db.posts.filter(p => !p.replyTo && !p.group && p.author.toLowerCase() === n.toLowerCase()).map(p => ({ post: p, at: p.at, by: null }));
        const rt = db.reposts.filter(r => r.by.toLowerCase() === n.toLowerCase()).map(r => ({ post: db.posts.find(p => p.id === r.postId), at: r.at, by: r.by })).filter(x => x.post);
        return vis(by, own.concat(rt), x => x.post.author).filter(x => !x.by || !hiddenFor(by, x.by)).sort((a, b) => b.at - a.at);
      },
      toggleLike(by, postId) {
        const p = db.posts.find(x => x.id === postId); need(p && seen(p, by), 'Post introuvable'); user(by); guard(by);
        const i = p.likes.indexOf(by);
        if (i >= 0) p.likes.splice(i, 1); else { p.likes.push(by); notify(p.author, by, 'like', postId); }
        save(); return p.likes.length;
      },
      // réactions variées : ❤️ = le like historique, les autres émojis vivent dans p.reactions {émoji: [noms]}
      reactEmojis: () => ['❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'],
      react(by, postId, emoji) {
        need(api.reactEmojis().includes(emoji), 'Réaction inconnue');
        if (emoji === '❤️') return api.toggleLike(by, postId);
        const p = db.posts.find(x => x.id === postId); need(p && seen(p, by), 'Post introuvable'); const me = user(by); guard(by);
        p.reactions = p.reactions || {}; const l = p.reactions[emoji] = p.reactions[emoji] || [];
        const i = l.indexOf(me.name);
        if (i >= 0) l.splice(i, 1); else { l.push(me.name); notify(p.author, me.name, 'react', postId, { emoji }); }
        if (!l.length) delete p.reactions[emoji];
        save(); return l.length;
      },
      // détail : [{emoji, users, count}] trié par popularité (❤️ inclus), sans les comptes cachés pour `by`
      reactions(postId, by) {
        const p = db.posts.find(x => x.id === postId); if (!p) return [];
        const all = Object.assign({ '❤️': p.likes }, p.reactions || {});
        return Object.entries(all).map(([emoji, users]) => ({ emoji, users: users.filter(u => !by || !hiddenFor(by, u)), count: users.length })).filter(r => r.count).sort((a, b) => b.count - a.count);
      },
      myReactions: (by, postId) => api.reactions(postId).filter(r => r.users.some(u => lc(u) === lc(by || ''))).map(r => r.emoji),
      // citation : nouveau post avec son propre commentaire, qui intègre le post cité (carte)
      quote(by, postId, text) {
        const q = db.posts.find(x => x.id === postId); need(q && seen(q, by), 'Post introuvable'); need(!q.group, 'Les posts d’une communauté ne se citent pas');
        need((text || '').trim(), 'Ajoutez votre commentaire pour citer'); need(!blockedBy(by, q.author), 'Cet utilisateur vous a bloqué : citation impossible');
        const p = makePost(by, text, null, [], null, null); p.quoteOf = q.id;
        if (lc(q.author) !== lc(p.author)) notify(q.author, p.author, 'quote', p.id);
        save(); return p;
      },
      quotes: postId => db.posts.filter(p => p.quoteOf === postId).sort((a, b) => b.id - a.id),
      quoteCount: postId => db.posts.filter(p => p.quoteOf === postId).length,
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
        return db.posts.filter(p => !p.replyTo && !p.group && !hiddenFor(by, p.author) && (p.author === me.name || me.following.includes(p.author))).sort((a, b) => b.id - a.id);
      },
      explore: by => vis(by, db.posts.filter(p => !p.replyTo && !p.group), p => p.author).sort((a, b) => b.id - a.id),
      replies: (postId, by) => vis(by, db.posts.filter(p => p.replyTo === postId), p => p.author).sort((a, b) => a.id - b.id),
      byUser: (n, by) => vis(by, db.posts.filter(p => !p.replyTo && !p.group && p.author.toLowerCase() === n.toLowerCase()), p => p.author).sort((a, b) => b.id - a.id),
      // membres proposés par l'autocomplétion @ : préfixe du pseudo ou du nom affiché, abonnements d'abord
      mentionable(q, by, limit) {
        q = lc(q).replace(/^@/, '');
        const me = db.users[lc(by)], fol = me ? me.following.map(lc) : [];
        const hit = u => !q || lc(u.name).startsWith(q) || lc(u.display).split(/\s+/).some(w => w.startsWith(q));
        return vis(by, Object.values(db.users).filter(u => hit(u) && lc(u.name) !== lc(by)), u => u.name)
          .sort((a, b) => (fol.includes(lc(b.name)) - fol.includes(lc(a.name))) || (lc(b.name).startsWith(q) - lc(a.name).startsWith(q)) || lc(a.name).localeCompare(lc(b.name)))
          .slice(0, limit || 5).map(u => ({ name: u.name, display: u.display || '' }));
      },
      search(q, by) {
        q = (q || '').trim().toLowerCase(); if (!q) return { users: [], posts: [] };
        return {
          users: vis(by, Object.values(db.users).filter(u => u.name.toLowerCase().includes(q)), u => u.name),
          posts: vis(by, db.posts.filter(p => !p.group && p.text.toLowerCase().includes(q)), p => p.author).sort((a, b) => b.id - a.id),
        };
      },
      trending() {
        const c = {};
        for (const p of db.posts) if (!p.group) for (const t of p.text.match(/#\w+/g) || []) c[t.toLowerCase()] = (c[t.toLowerCase()] || 0) + 1;
        return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5);
      },
      // score d'un post : likes + réponses, pondérés par la fraîcheur (demi-vie ~3 h)
      score: p => scoreOf(p),
      // classement des posts « en tendance », meilleur score d'abord
      ranking(limit, by) {
        return vis(by, db.posts.filter(p => !p.replyTo && !p.group), p => p.author).map(p => ({ post: p, score: scoreOf(p) })).sort((a, b) => b.score - a.score).slice(0, limit || 5);
      },
      // hashtags du moment : score = somme des scores des posts qui les contiennent
      trendingLive(limit) {
        const c = {};
        for (const p of db.posts) if (!p.group) for (const t of new Set((p.text.match(/#\w+/g) || []).map(x => x.toLowerCase()))) { const e = c[t] || (c[t] = { tag: t, count: 0, score: 0 }); e.count++; e.score += scoreOf(p); }
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
          posts: db.posts.filter(p => p.author === u.name && !p.group).map(p => ({ text: p.text, at: p.at, replyTo: p.replyTo, images: p.images || [] })),
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
        for (const m of db.messages) if (m.to === me.name && m.id > (r[lc(m.from)] || 0) && m.id > (((me.dmCleared || {})[lc(m.from)]) || 0) && !hiddenFor(by, m.from)) { peers[m.from] = (peers[m.from] || 0) + 1; total++; }
        return { total, peers };
      },
      // pagination par curseur (id décroissant) : scope « feed » (abonnements) ou « explore » ; `after` compte les posts plus récents
      page(by, scope, o) {
        o = o || {};
        const all = scope === 'feed' ? api.feed(by) : scope === 'group' ? api.groupFeed(by, +o.group) : scope === 'list' ? api.listFeed(by, o.owner, +o.list) : api.explore(by), limit = Math.min(50, Math.max(1, +o.limit || 10));
        if (o.after) return { count: all.filter(p => p.id > +o.after).length };
        const rest = o.before ? all.filter(p => p.id < +o.before) : all;
        return { posts: rest.slice(0, limit), more: rest.length > limit, total: all.length };
      },
      conversation(a, b) {
        if (hiddenFor(a, b)) return [];
        const cut = ((user(a).dmCleared || {})[lc(b)]) || 0;
        a = a.toLowerCase(); b = b.toLowerCase();
        return db.messages.filter(m => m.id > cut && [m.from.toLowerCase(), m.to.toLowerCase()].sort().join() === [a, b].sort().join());
      },
      // liste des discussions 1-à-1 de `by` (la plus récente d'abord) : { peer, last, unread }
      conversations(by) {
        const me = user(by), un = api.unreadDm(by).peers, out = new Map();
        for (const m of db.messages) {
          if (m.from !== me.name && m.to !== me.name) continue;
          const peer = m.from === me.name ? m.to : m.from;
          if (!db.users[lc(peer)] || hiddenFor(by, peer)) continue;
          if (m.id <= (((me.dmCleared || {})[lc(peer)]) || 0)) continue;
          out.set(peer, { peer, last: m, unread: un[peer] || 0 });
        }
        return [...out.values()].sort((x, y) => y.last.id - x.last.id);
      },
      // supprime l'échange pour `by` seulement (l'autre membre le garde) ; purge réelle quand les deux l'ont supprimé
      deleteConversation(by, peer) {
        const me = user(by), t = user(peer), k = lc(t.name);
        const ids = db.messages.filter(m => (m.from === me.name && m.to === t.name) || (m.from === t.name && m.to === me.name)).map(m => m.id);
        need(ids.length, 'Aucun échange à supprimer');
        const last = Math.max(...ids);
        (me.dmCleared = me.dmCleared || {})[k] = last;
        (me.dmRead = me.dmRead || {})[k] = Math.max((me.dmRead || {})[k] || 0, last);
        const cut = ((t.dmCleared || {})[lc(me.name)]) || 0;
        db.messages = db.messages.filter(m => !(ids.includes(m.id) && m.id <= last && m.id <= cut));
        save();
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
      // « Qui suivre » : amis d'amis (comptes suivis par mes abonnements) + sujets communs (#hashtags de mes posts et likes) ;
      // sans rien de tout cela (nouveau compte) : comptes populaires et actifs. Écarte moi, Streamer, suivis, bloqués, masqués et ignorés.
      suggestions(by, limit) {
        const me = user(by), out = [], tagsOf = ps => { const c = {}; for (const p of ps) for (const t of new Set((p.text.match(/#\w+/g) || []).map(x => x.toLowerCase()))) c[t] = (c[t] || 0) + 1; return c; };
        const mine = tagsOf(db.posts.filter(p => p.author === me.name || has(p.likes, me.name)));
        const followers = {}; for (const u of Object.values(db.users)) for (const f of u.following || []) followers[lc(f)] = (followers[lc(f)] || 0) + 1;
        for (const c of Object.values(db.users)) {
          if (c === me || c.admin || has(me.following, c.name) || has(me.dismissed, c.name) || has(me.blocked, c.name) || has(me.muted, c.name) || has(c.blocked, me.name)) continue;
          const via = (me.following || []).filter(f => has((db.users[lc(f)] || {}).following, c.name)).map(f => (db.users[lc(f)] || {}).name || f);
          const theirs = tagsOf(db.posts.filter(p => p.author === c.name)), shared = Object.keys(theirs).filter(t => mine[t]);
          const recent = db.posts.some(p => p.author === c.name && now() - p.at < 7 * 86400000), fans = followers[lc(c.name)] || 0;
          const score = via.length * 3 + shared.length * 2, pop = fans + (recent ? 1 : 0);
          out.push({ name: c.name, via: via.slice(0, 3), mutual: via.length, tags: shared.slice(0, 3), score, pop, reason: via.length ? 'friends' : shared.length ? 'topics' : 'popular' });
        }
        const hasSignal = out.some(x => x.score > 0);
        return out.filter(x => x.score > 0 || (!hasSignal && x.pop > 0) || (hasSignal && x.pop > 1))
          .sort((a, b) => b.score - a.score || b.pop - a.pop || a.name.localeCompare(b.name)).slice(0, limit || 5);
      },
      dismissSuggestion(by, target) {
        const me = user(by), t = user(target); need(me !== t, 'Impossible de s’ignorer soi-même');
        const d = me.dismissed = me.dismissed || []; if (!has(d, t.name)) d.push(t.name);
        save(); return d.length;
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
        const hp = action === 'hide' && db.posts.find(x => x.id === postId);
        if (action === 'hide') { need(hp, 'Post introuvable'); hp.hidden = { at: now(), by: user(by).name, reason: REASONS[open[0].reason] }; notify(hp.author, user(by).name, 'hide', postId); }
        if (target && ['warn', 'suspend', 'ban'].includes(action)) {
          const prev = target.sanction || {};
          target.sanction = { type: action, at: now(), by: user(by).name, reason: REASONS[open[0].reason], warnings: (prev.warnings || 0) + (action === 'warn' ? 1 : 0) };
          if (action === 'suspend') target.sanction.until = now() + hours * 36e5;
          (target.sanctions = target.sanctions || []).push({ type: action, at: now(), reason: REASONS[open[0].reason], hours: action === 'suspend' ? hours : 0, postId });
          notify(target.name, user(by).name, 'sanction', null, { what: action });
        }
        audit(by, 'report-' + action, target ? target.name : open[0].target, `post #${postId} · ${REASONS[open[0].reason]} · ${open.length} signalement(s)` + (action === 'suspend' ? ` · ${hours} h` : ''));
        for (const r of open) Object.assign(r, { status: action === 'dismiss' ? 'dismissed' : 'actioned', action, closedAt: now(), closedBy: user(by).name });
        save();
        if (action === 'delete') api.deletePost(by, postId); // relit le storage : à faire après l'enregistrement
        return open.length;
      },
      // ---- tableau de bord d'administration : utilisateurs, statistiques globales, journal d'audit ----
      appeal(by, kind, postId, text) {
        const u = user(by); text = String(text || '').trim();
        need(['sanction', 'hide'].includes(kind), 'Type d’appel inconnu'); need(text.length >= 5 && text.length <= 500, 'Expliquez votre appel : 5 à 500 caractères');
        let subject;
        if (kind === 'sanction') { const s = api.sanctionOf(u.name); need(s, 'Aucune mesure à contester'); postId = null; subject = SANC_TXT[s.type] + ' · ' + (s.reason || ''); }
        else { const p = db.posts.find(x => x.id === postId); need(p && p.author === u.name && p.hidden, 'Ce post n’est pas masqué'); subject = (p.text || '').slice(0, 120); }
        db.appeals = db.appeals || [];
        need(!db.appeals.some(a => a.user === u.name && a.kind === kind && a.postId === postId && a.status === 'open'), 'Vous avez déjà fait appel : un modérateur va répondre');
        const a = { id: id(), user: u.name, kind, postId, text, at: now(), status: 'open', subject };
        db.appeals.push(a); for (const m of Object.values(db.users)) if (m.admin) notify(m.name, u.name, 'appeal', postId, { what: 'new' });
        save(); return a;
      },
      // admin : appels ouverts ; membre : ses propres appels (ouverts et tranchés)
      appeals(by) {
        const u = user(by), l = db.appeals || [];
        return u.admin ? l.filter(a => a.status === 'open').sort((a, b) => a.at - b.at) : l.filter(a => a.user === u.name).sort((a, b) => b.at - a.at);
      },
      hasAppealed: (by, kind, postId) => (db.appeals || []).some(a => lc(a.user) === lc(by) && a.kind === kind && a.postId === (postId || null) && a.status === 'open'),
      decideAppeal(by, appealId, accept, answer) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        const a = (db.appeals || []).find(x => x.id === appealId); need(a && a.status === 'open', 'Appel introuvable ou déjà traité');
        answer = String(answer || '').trim().slice(0, 300);
        if (accept) {
          const u = db.users[lc(a.user)], p = db.posts.find(x => x.id === a.postId);
          if (a.kind === 'sanction') { if (u) delete u.sanction; } else if (p) delete p.hidden;
        }
        Object.assign(a, { status: accept ? 'accepted' : 'rejected', answer, closedAt: now(), closedBy: user(by).name });
        audit(by, accept ? 'appeal-accept' : 'appeal-reject', a.user, (a.kind === 'hide' ? `post #${a.postId}` : 'sanction') + (answer ? ' · ' + answer : ''));
        notify(a.user, user(by).name, 'appeal', a.postId, { what: accept ? 'accepted' : 'rejected', answer });
        save();
      },
      adminUsers(by) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        return Object.values(db.users).map(u => ({ name: u.name, display: u.display || u.name, joined: u.joined, admin: !!u.admin, sanction: api.sanctionOf(u.name), warnings: (u.sanctions || []).length,
          posts: db.posts.filter(p => p.author === u.name).length, reports: db.reports.filter(r => r.target === u.name && r.status === 'open').length })).sort((a, b) => b.joined - a.joined);
      },
      // sanction directe d'un compte (sans passer par un signalement) : warn | suspend | ban
      adminSanction(by, n, type, hours, reason) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); need(['warn', 'suspend', 'ban'].includes(type), 'Action inconnue');
        const u = user(n); need(!u.admin, 'Impossible de sanctionner un administrateur');
        reason = String(reason || '').trim().slice(0, 200) || 'Décision de l’administrateur'; hours = Math.min(24 * 90, Math.max(1, +hours || 24));
        const prev = u.sanction || {};
        u.sanction = { type, at: now(), by: user(by).name, reason, warnings: (prev.warnings || 0) + (type === 'warn' ? 1 : 0) };
        if (type === 'suspend') u.sanction.until = now() + hours * 36e5;
        (u.sanctions = u.sanctions || []).push({ type, at: now(), reason, hours: type === 'suspend' ? hours : 0 });
        notify(u.name, user(by).name, 'sanction', null);
        audit(by, 'user-' + type, u.name, reason + (type === 'suspend' ? ` · ${hours} h` : '')); save();
      },
      adminDeleteUser(by, n, reason) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); const u = user(n); need(!u.admin, 'Le compte Streamer ne peut pas être supprimé');
        audit(by, 'user-delete', u.name, String(reason || '').trim().slice(0, 200) || 'Décision de l’administrateur'); purge(u); save();
      },
      adminStats(by) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        const day = 86400000, t = now(), users = Object.values(db.users), t0 = db.totals || {};
        const act = users.filter(u => u.sanction && (u.sanction.type !== 'suspend' || u.sanction.until > t));
        const roots = db.posts.filter(p => !p.replyTo).length, replies = db.posts.length - roots;
        return { users: users.length, newUsers7: users.filter(u => t - u.joined < 7 * day).length, posts: roots + (t0.hiddenPosts || 0), replies, messages: db.messages.length + (t0.hiddenMessages || 0), groups: db.groups.length,
          likes: db.posts.reduce((s, p) => s + p.likes.length, 0), posts24: db.posts.filter(p => t - p.at < day).length, openReports: new Set(db.reports.filter(r => r.status === 'open').map(r => r.postId)).size,
          closedReports: db.reports.filter(r => r.status !== 'open').length, suspended: act.filter(u => u.sanction.type === 'suspend').length, banned: act.filter(u => u.sanction.type === 'ban').length };
      },
      auditLog(by, limit) { need(api.isAdmin(by), 'Réservé à l’administrateur'); return (db.audit || []).slice(-(limit || 100)).reverse(); },
      // sanction active d'un compte (null si aucune ou expirée) ; l'admin peut la lever
      sanctionOf(n) { const s = (db.users[lc(n)] || {}).sanction; if (!s) return null; if (s.type === 'suspend' && s.until <= now()) return null; return s; },
      liftSanction(by, n) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); const u = user(n); need(u.sanction, 'Aucune sanction active');
        audit(by, 'lift', u.name, u.sanction.type); delete u.sanction; save();
      },
      sanctioned: by => { need(api.isAdmin(by), 'Réservé à l’administrateur'); return Object.values(db.users).filter(u => u.sanction && (u.sanction.type !== 'suspend' || u.sanction.until > now())).map(u => ({ name: u.name, sanction: u.sanction })); },
      // ---- communautés thématiques : publiques (lisibles par tous, adhésion libre) ou privées (sur demande ou invitation) ----
      createGroup(by, name, desc, rules, isPublic) {
        const u = user(by); guard(by); name = String(name || '').trim().replace(/\s+/g, ' '); desc = String(desc || '').trim(); rules = String(rules || '').trim();
        need(name.length >= 3 && name.length <= 40, 'Nom de communauté : 3 à 40 caractères');
        need(!db.groups.some(g => lc(g.name) === lc(name)), 'Une communauté porte déjà ce nom');
        need(desc.length <= 160, 'Description : 160 caractères max'); need(rules.length <= MAX_RULES, `Règles : ${MAX_RULES} caractères max`);
        need(db.groups.filter(g => lc(g.owner) === lc(u.name)).length < MAX_OWN_GROUPS, `${MAX_OWN_GROUPS} communautés maximum par compte`);
        const g = { id: id(), name, desc, rules, public: !!isPublic, owner: u.name, mods: [], members: [u.name], requests: [], invites: [], banned: [], at: now() };
        db.groups.push(g); save(); return g;
      },
      // le propriétaire change tout ; les modérateurs ajustent la description et les règles
      updateGroup(by, gid, o) {
        const g = grp(gid), u = user(by); needMod(g, by); o = o || {}; guard(by);
        if (o.name !== undefined || o.public !== undefined) need(roleIn(g, u.name) === 'owner', 'Réservé au propriétaire');
        if (o.name !== undefined) {
          const name = String(o.name).trim().replace(/\s+/g, ' '); need(name.length >= 3 && name.length <= 40, 'Nom de communauté : 3 à 40 caractères');
          need(!db.groups.some(x => x !== g && lc(x.name) === lc(name)), 'Une communauté porte déjà ce nom'); g.name = name;
        }
        if (o.desc !== undefined) { const d = String(o.desc).trim(); need(d.length <= 160, 'Description : 160 caractères max'); g.desc = d; }
        if (o.rules !== undefined) { const r = String(o.rules).trim(); need(r.length <= MAX_RULES, `Règles : ${MAX_RULES} caractères max`); g.rules = r; }
        if (o.public !== undefined) { g.public = !!o.public; if (g.public) { for (const n of g.requests.splice(0)) { g.members.push(n); notify(n, u.name, 'group', null, { group: g.id, what: 'accepted' }); } } }
        save(); return g;
      },
      deleteGroup(by, gid) { const g = grp(gid); need(roleIn(g, user(by).name) === 'owner' || api.isAdmin(by), 'Réservé au propriétaire'); dropGroup(g); save(); },
      // public : adhésion immédiate ; privé : demande (ou acceptation directe si on a été invité)
      joinGroup(by, gid) {
        const g = grp(gid), u = user(by); guard(by); const r = roleIn(g, u.name);
        need(!has(g.banned, u.name), 'Vous êtes banni de cette communauté');
        need(r !== 'owner' && r !== 'mod' && r !== 'member', 'Vous êtes déjà membre');
        if (g.public || r === 'invited') { g.invites = g.invites.filter(x => lc(x) !== lc(u.name)); g.members.push(u.name); save(); return 'member'; }
        need(r !== 'pending', 'Demande déjà envoyée');
        g.requests.push(u.name); for (const m of new Set([g.owner, ...g.mods])) notify(m, u.name, 'group', null, { group: g.id, what: 'request' });
        save(); return 'pending';
      },
      // quitter la communauté ou retirer sa demande d'adhésion
      leaveGroup(by, gid) {
        const g = grp(gid), n = user(by).name; need(roleIn(g, n) !== 'owner', 'Le propriétaire ne peut pas quitter : supprimez la communauté');
        for (const k of ['mods', 'members', 'requests']) g[k] = g[k].filter(x => lc(x) !== lc(n));
        save();
      },
      handleRequest(by, gid, who, accept) {
        const g = grp(gid), u = user(by); needMod(g, by); guard(by); const t = user(who);
        need(has(g.requests, t.name), 'Aucune demande de ce compte');
        g.requests = g.requests.filter(x => lc(x) !== lc(t.name));
        if (accept) { g.members.push(t.name); notify(t.name, u.name, 'group', null, { group: g.id, what: 'accepted' }); }
        save(); return !!accept;
      },
      // invitation : tout membre d'une communauté publique, les modérateurs seuls pour une privée
      inviteToGroup(by, gid, target) {
        const g = grp(gid), u = user(by), t = user(target); guard(by);
        need(g.public ? isMember(g, u.name) : canMod(g, u.name), g.public ? 'Rejoignez la communauté pour inviter' : 'Seuls les modérateurs invitent dans une communauté privée');
        need(!isMember(g, t.name), 'Déjà membre'); need(!has(g.banned, t.name), 'Ce compte est banni de la communauté');
        need(!blockedBy(u.name, t.name) && !has(t.blocked, u.name), 'Invitation impossible'); need(!has(g.invites, t.name), 'Déjà invité');
        if (has(g.requests, t.name)) { g.requests = g.requests.filter(x => lc(x) !== lc(t.name)); g.members.push(t.name); notify(t.name, u.name, 'group', null, { group: g.id, what: 'accepted' }); save(); return 'member'; }
        g.invites.push(t.name); notify(t.name, u.name, 'group', null, { group: g.id, what: 'invite' }); save(); return 'invited';
      },
      respondInvite(by, gid, accept) {
        const g = grp(gid), n = user(by).name; need(has(g.invites, n), 'Aucune invitation');
        g.invites = g.invites.filter(x => lc(x) !== lc(n)); if (accept) { need(!has(g.banned, n), 'Vous êtes banni de cette communauté'); g.members.push(n); }
        save(); return !!accept;
      },
      cancelInvite(by, gid, who) { const g = grp(gid); needMod(g, by); g.invites = g.invites.filter(x => lc(x) !== lc(who)); save(); },
      // retirer un membre (avec ou sans bannissement) : les modérateurs ne touchent ni aux autres modérateurs ni au propriétaire
      removeFromGroup(by, gid, who, ban) {
        const g = grp(gid), me = user(by).name; needMod(g, by); const t = user(who), r = roleIn(g, t.name);
        need(r !== 'owner', 'Le propriétaire ne peut pas être retiré'); need(r !== 'mod' || roleIn(g, me) === 'owner', 'Seul le propriétaire retire un modérateur');
        need(r !== null || ban, 'Ce compte n’est pas dans la communauté');
        for (const k of ['mods', 'members', 'requests', 'invites']) g[k] = g[k].filter(x => lc(x) !== lc(t.name));
        if (ban && !has(g.banned, t.name)) g.banned.push(t.name);
        if (r === 'member' || r === 'mod') notify(t.name, me, 'group', null, { group: g.id, what: ban ? 'banned' : 'removed' });
        save();
      },
      unbanFromGroup(by, gid, who) { const g = grp(gid); needMod(g, by); g.banned = g.banned.filter(x => lc(x) !== lc(who)); save(); },
      setGroupMod(by, gid, who, on) {
        const g = grp(gid); need(roleIn(g, user(by).name) === 'owner', 'Réservé au propriétaire'); const t = user(who), r = roleIn(g, t.name);
        need(r === 'member' || r === 'mod', 'Ce compte doit d’abord être membre');
        g.mods = g.mods.filter(x => lc(x) !== lc(t.name)); if (on) { g.mods.push(t.name); notify(t.name, g.owner, 'group', null, { group: g.id, what: 'mod' }); }
        save(); return !!on;
      },
      groups: () => db.groups.slice().sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name)),
      group: gid => grp(gid),
      groupRole: (by, gid) => roleIn(grp(gid), by),
      myGroups: by => db.groups.filter(g => isMember(g, by)),
      // fil dédié : posts racines de la communauté (lisible par tous si publique, par ses membres sinon)
      groupFeed(by, gid) {
        const g = grp(gid); need(canRead(g, by), 'Communauté privée : demandez à la rejoindre');
        return db.posts.filter(p => p.group === g.id && !p.replyTo && !hiddenFor(by, p.author)).sort((a, b) => b.id - a.id);
      },
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
      const { pass, epoch, blocked, muted, bookmarks, sanction, sanctions, dmRead, dmCleared, email, emailPending, lists, dismissed, ...pub } = u;
      if (lists) pub.lists = k === lcm ? lists : lists.filter(l => l.public);
      if (k === lcm) Object.assign(pub, { dismissed, blocked, muted, bookmarks, sanction, sanctions, dmRead, dmCleared, email, emailPending });
      else if (me.admin) Object.assign(pub, { sanction });
      users[k] = JSON.parse(JSON.stringify(pub));
    }
    // communautés : les privées ne montrent leurs membres, posts et demandes qu'à leurs membres
    const readable = new Set(), groups = db.groups.map(g => {
      const r = g.owner === me.name ? 'owner' : g.mods.includes(me.name) ? 'mod' : g.members.includes(me.name) ? 'member' : null, mod = r === 'owner' || r === 'mod', full = !!r || g.public;
      if (full) readable.add(g.id);
      const c = JSON.parse(JSON.stringify(g));
      if (!mod) { c.banned = []; c.requests = g.requests.filter(x => x === me.name); c.invites = g.invites.filter(x => x === me.name); }
      if (!full) { c.members = []; c.mods = []; c.count = g.members.length; }
      return c;
    });
    return {
      users, posts: db.posts.filter(p => !p.group || readable.has(p.group)).map(p => p.hidden && !me.admin && p.author !== me.name ? Object.assign({}, p, { text: '', images: [], poll: undefined, history: [], quoteOf: undefined }) : p), groups, reposts: db.reposts, seq: db.seq, drafts: db.drafts.filter(d => d.author === me.name), attempts: {},
      messages: db.messages.filter(m => m.from === me.name || m.to === me.name),
      notifs: db.notifs.filter(n => n.to === me.name),
      audit: me.admin ? (db.audit || []).slice(-300) : [], totals: me.admin ? { hiddenPosts: db.posts.filter(p => !p.replyTo && p.group && !readable.has(p.group)).length, hiddenMessages: db.messages.filter(m => m.from !== me.name && m.to !== me.name).length } : undefined,
      appeals: me.admin ? (db.appeals || []).slice(-200) : (db.appeals || []).filter(a => a.user === me.name),
      reports: me.admin ? db.reports : db.reports.filter(r => r.by === me.name).map(r => ({ id: r.id, postId: r.postId, by: r.by, status: r.status })),
    };
  }

  const exported = { Net, snapshot, KEY, MAX_IMAGES, cleanImages, REASONS };
  if (typeof module !== 'undefined') module.exports = exported; else root.Social = exported;
})(this);
