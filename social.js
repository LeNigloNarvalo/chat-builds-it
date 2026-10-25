// Moteur de Cornichon : les données sont PARTAGÉES via un « storage » injecté (localStorage).
// Chaque appel relit le storage (lecture-modification-écriture) : aucune copie ancienne n'est conservée en mémoire.
(function (root) {
  const KEY = 'twitchgram.v1';
  const empty = () => ({ users: Object.create(null), posts: [], messages: [], notifs: [], reposts: [], reports: [], appeals: [], tickets: [], verifs: [], badgeLog: [], drafts: [], media: [], groups: [], events: [], rooms: [], msgReports: [], audit: [], seq: 1, attempts: Object.create(null) });
  const MAX_PINS = 3, MAX_FAILS = 5, LOCK_MS = 60000, EDIT_MS = 15 * 60000, MAX_DRAFTS = 30, MAX_LISTS = 20, MAX_LIST_MEMBERS = 200, MAX_AHEAD_MS = 366 * 86400000, POLL_MAX_MIN = 7 * 1440, MAX_OWN_GROUPS = 10, MAX_RULES = 600;

  const EV_ANSWERS = ['yes', 'maybe', 'no'], EV_REMINDS = [0, 15, 60, 180, 1440], EV_GRACE = 3 * 3600000, MAX_EVENTS = 30;
  const icsEsc = v => String(v || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, c => '\\' + c);
  const icsDate = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  // iCalendar : lignes CRLF, repliées à 75 octets
  const fold = line => { const out = []; let cur = ''; for (const ch of line) { if (byteLen(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch; } out.push(cur); return out.join('\r\n '); };
  const byteLen = s => new TextEncoder().encode(s).length;
  function ics(list, by) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cornichon//Agenda//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Agenda Cornichon'];
    for (const e of list) {
      const a = e.rsvps[String(by || '').toLowerCase()];
      L.push('BEGIN:VEVENT', `UID:event-${e.id}@cornichon`, `DTSTAMP:${icsDate(e.at)}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.start + 3600000)}`, `SUMMARY:${icsEsc(e.title)}`);
      if (e.place) L.push(`LOCATION:${icsEsc(e.place)}`);
      L.push(`DESCRIPTION:${icsEsc((e.desc ? e.desc + '\n' : '') + 'Organisé par @' + e.owner)}`, `ORGANIZER;CN=${icsEsc(e.owner)}:mailto:noreply@cornichon.invalid`, `STATUS:${a === 'maybe' ? 'TENTATIVE' : 'CONFIRMED'}`);
      if (e.remind > 0) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(e.title)}`, `TRIGGER:-PT${e.remind}M`, 'END:VALARM');
      L.push('END:VEVENT');
    }
    L.push('END:VCALENDAR'); return L.map(fold).join('\r\n') + '\r\n';
  }
  // badges de confiance : « vérifié » et « modérateur » sont attribués (et révocables) par les administrateurs, « ancien » est automatique
  const BADGES = { verified: { icon: '✅', label: 'Vérifié' }, moderator: { icon: '🛡', label: 'Modérateur' }, veteran: { icon: '🏅', label: 'Ancien' } }, GRANTABLE = ['verified', 'moderator'], VETERAN_MS = 30 * 86400000, VERIF_COOLDOWN_MS = 86400000;
  const RESERVED = 'streamer';
  // « Pour vous » : mots masqués (insensibles à la casse et aux accents ; « #sujet » vise un hashtag, le reste un mot ou une expression entière)
  const MAX_FY_WORDS = 100;
  const fyNorm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const fyTags = p => [...new Set(String(p.text || '').toLowerCase().match(/#\w+/g) || [])];
  const fyEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fyMuted = (p, words) => {
    if (!words.length) return false;
    const t = fyNorm(p.text);
    return words.some(w => { const n = fyNorm(w); return n && new RegExp('(^|[^\\p{L}\\p{N}_#])' + fyEsc(n) + '(?![\\p{L}\\p{N}_])', 'u').test(t); });
  };
  // signalements : motifs, sanctions de modération (durée de suspension en heures)
  const REASONS = { spam: 'Spam ou publicité', harcelement: 'Harcèlement', haine: 'Haine ou discrimination', violence: 'Violence ou menace', nsfw: 'Contenu inapproprié', autre: 'Autre' };
  const SANC_TXT = { warn: 'Avertissement', mute: 'Mute', suspend: 'Suspension', ban: 'Bannissement' };
  const ACTIONS = ['dismiss', 'hide', 'delete', 'warn', 'mute', 'suspend', 'ban'];
  // images jointes : jusqu'à 4 par post/message, en data URL (redimensionnées côté navigateur), avec texte alternatif
  const MAX_IMAGES = 4, MAX_IMG_CHARS = 400000, IMG_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  function cleanImages(list) {
    list = list == null ? [] : list;
    if (!Array.isArray(list)) throw new Error('Images invalides');
    list = list.filter(i => !(i && i.kind)); // les vidéos et messages vocaux passent par cleanMedia
    if (list.length > MAX_IMAGES) throw new Error('4 images maximum');
    return list.map(i => {
      const src = String((i && i.src) || '');
      if (!IMG_RE.test(src)) throw new Error('Image invalide (JPEG, PNG, WebP ou GIF)');
      if (src.length > MAX_IMG_CHARS) throw new Error('Image trop lourde');
      return { src, alt: String((i && i.alt) || '').trim().slice(0, 200) };
    });
  }
  // vidéos courtes et messages vocaux : un seul par post/message, en data URL (compressés côté navigateur), durée et taille limitées
  const MAX_MEDIA_CHARS = 2000000, MAX_VIDEO_S = 15, MAX_AUDIO_S = 120, MEDIA_RE = { video: /^data:video\/(webm|mp4)(;codecs=[A-Za-z0-9.,]+)?;base64,[A-Za-z0-9+\/=]+$/, audio: /^data:audio\/(webm|ogg|mp4|mpeg|wav)(;codecs=[A-Za-z0-9.,]+)?;base64,[A-Za-z0-9+\/=]+$/ };
  function cleanMedia(list) {
    const l = (Array.isArray(list) ? list : []).filter(i => i && i.kind);
    if (l.length > 1) throw new Error('Une seule vidéo ou un seul message vocal par envoi');
    return l.map(i => {
      const kind = i.kind, src = String(i.src || '');
      if (kind !== 'video' && kind !== 'audio') throw new Error('Type de média invalide');
      if (!MEDIA_RE[kind].test(src)) throw new Error(kind === 'video' ? 'Vidéo invalide (WebM ou MP4)' : 'Message vocal invalide');
      if (src.length > MAX_MEDIA_CHARS) throw new Error(kind === 'video' ? 'Vidéo trop lourde (1,5 Mo max)' : 'Message vocal trop lourd (1,5 Mo max)');
      const dur = Math.max(0, Math.min(+i.dur || 0, kind === 'video' ? MAX_VIDEO_S : MAX_AUDIO_S));
      return { kind, src, dur: Math.round(dur * 10) / 10, alt: String(i.alt || '').trim().slice(0, 200) };
    });
  }
  // médiathèque personnelle : images compressées + miniature (faites dans le navigateur), texte alternatif, quota de stockage par compte
  const MEDIA_QUOTA = 8 * 1024 * 1024, MAX_THUMB_CHARS = 40000, MAX_MEDIA = 200;
  const b64Bytes = s => Math.floor((s.length - s.indexOf(',') - 1) * 3 / 4);
  const subtle = () => (root.crypto || require('crypto').webcrypto).subtle;
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha = async s => hex(await subtle().digest('SHA-256', new TextEncoder().encode(s)));
  const randHex = n => hex((root.crypto || require('crypto').webcrypto).getRandomValues(new Uint8Array(n)));
  // mot de passe : jamais en clair, « sel$SHA-256(sel + mot de passe) »
  async function hashPw(pw, salt) { salt = salt || randHex(16); return salt + '$' + await sha(salt + pw); }

    // ---- préférences de notifications (par compte) : pour chaque type, cloche / push / e-mail ; heures calmes ; résumé quotidien ----
  const NP_TYPES = ['mention', 'dm', 'reply', 'follow', 'group', 'event'], NP_CHANNELS = ['bell', 'push', 'email'];
  const NP_DEFAULT = { mention: { bell: true, push: true, email: false }, dm: { bell: false, push: true, email: false }, reply: { bell: true, push: true, email: false }, follow: { bell: true, push: true, email: false }, group: { bell: true, push: true, email: false }, event: { bell: true, push: true, email: false } };
  const hhmm = v => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || '')); return m ? m[0] : null; };
  const toMin = v => +v.slice(0, 2) * 60 + +v.slice(3);
  function normPrefs(o) {
    o = o || {}; const types = {};
    for (const t of NP_TYPES) { types[t] = {}; for (const c of NP_CHANNELS) types[t][c] = o.types && o.types[t] && typeof o.types[t][c] === 'boolean' ? o.types[t][c] : NP_DEFAULT[t][c]; }
    const q = o.quiet || {}, d = o.digest || {};
    return { types, quiet: { on: !!q.on, from: hhmm(q.from) || '22:00', to: hhmm(q.to) || '08:00' }, digest: { on: !!d.on, hour: Math.min(23, Math.max(0, Math.floor(+d.hour))) || (d.hour === 0 ? 0 : 8) },
      tz: Math.abs(+o.tz) <= 840 ? Math.round(+o.tz) || 0 : 0, since: +o.since || 0, last: +o.last || 0 };
  }
  // minutes écoulées depuis minuit, à l'heure de l'utilisateur (tz = Date.getTimezoneOffset() de son navigateur)
  const localMin = (at, tz) => ((Math.floor(at / 60000) - tz) % 1440 + 1440) % 1440;
  // heures calmes : fenêtre [from, to[ qui peut passer minuit
  function inQuiet(p, at) {
    if (!p.quiet.on) return false;
    const a = toMin(p.quiet.from), b = toMin(p.quiet.to), m = localMin(at == null ? Date.now() : at, p.tz);
    return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
  }
  const NP_LABEL = { event: 'RSVP ou rappel d’événement', mention: 'vous a mentionné', dm: 'vous a écrit', reply: 'a répondu à votre post', follow: 'vous suit maintenant', like: 'a aimé votre post', repost: 'a repartagé votre post', quote: 'a cité votre post', react: 'a réagi à votre post', poll: 'sondage terminé', group: 'activité dans une communauté', search: 'nouveaux résultats d’une recherche enregistrée', sanction: 'mesure de modération', hide: 'post masqué', appeal: 'appel de modération' };

  // ---- confidentialité : qui voit le profil et les publications (all | followers | me) ; suppression de compte avec délai de grâce ----
  const PRIV_LEVELS = ['all', 'followers', 'me'], GRACE_MS = 7 * 86400000;
  const normPrivacy = o => { o = o || {}; const f = k => PRIV_LEVELS.includes(o[k]) ? o[k] : 'all'; return { profile: f('profile'), posts: f('posts') }; };
  // `by` peut-il voir `key` (profile | posts) de `author` ? Soi-même et la modération : toujours.
  function privOk(db, by, author, key) {
    const u = db.users[String(author || '').toLowerCase()], lv = u && u.privacy && u.privacy[key] || 'all';
    if (lv === 'all') return true;
    const v = db.users[String(by || '').toLowerCase()];
    return !!v && (v === u || !!v.admin || lv === 'followers' && v.following.includes(u.name));
  }

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
    const radm = (r, n) => !!r && (lc(r.owner) === lc(n) || has(r.admins || [], n)); // pas via api.* : api recharge db à chaque appel
    const has = (list, n) => (list || []).some(x => lc(x) === lc(n));
    // masqué pour `by` : compte bloqué ou masqué par lui (ses posts, réponses et DM disparaissent)
    const hiddenFor = (by, author) => { const u = db.users[lc(by)]; return !!(u && author && lc(author) !== lc(by) && (has(u.blocked, author) || has(u.muted, author))); };
    const guard = (n, speak) => {
      const s = user(n).sanction; if (!s) return;
      need(!(speak && s.type === 'mute' && s.until > now()), `Compte en mute (lecture seule) pendant encore ${Math.ceil((s.until - now()) / 60000)} min : vous ne pouvez ni publier ni écrire`);
      need(s.type !== 'ban', 'Votre compte est banni : action impossible');
      need(!(s.type === 'suspend' && s.until > now()), `Compte suspendu pendant encore ${Math.ceil((s.until - now()) / 60000)} min`);
    };
    // journal d'audit des actions de modération (visible des seuls administrateurs)
    const audit = (by, type, target, detail) => { db.audit = db.audit || []; db.audit.push({ id: id(), at: now(), by: user(by).name, type, target: target || null, detail: detail || '' }); if (db.audit.length > 2000) db.audit = db.audit.slice(-2000); };
    // historique des badges (demandes, attributions, refus, révocations), conservé même après révocation
    const blog = (name, badge, action, by, reason) => { db.badgeLog = db.badgeLog || []; db.badgeLog.push({ id: id(), at: now(), user: name, badge, action, by: by || name, reason: reason || '' }); if (db.badgeLog.length > 3000) db.badgeLog.splice(0, db.badgeLog.length - 3000); };
    const purge = u => { // supprime un compte avec tout ce qui le concerne
        const n = u.name;
        for (const g of db.groups.filter(x => lc(x.owner) === lc(n))) dropGroup(g); // ses communautés disparaissent avec lui
        for (const g of db.groups) for (const k of ['mods', 'members', 'requests', 'invites', 'banned']) g[k] = g[k].filter(x => lc(x) !== lc(n));
        db.verifs = (db.verifs || []).filter(v => lc(v.user) !== lc(n)); db.badgeLog = (db.badgeLog || []).filter(e => lc(e.user) !== lc(n));
        const gone = new Set(db.posts.filter(p => p.author === n).map(p => p.id));
        db.posts = db.posts.filter(p => !gone.has(p.id) && !gone.has(p.replyTo));
        for (const p of db.posts) { p.likes = p.likes.filter(x => x !== n); for (const e of Object.keys(p.reactions || {})) p.reactions[e] = p.reactions[e].filter(x => x !== n); }
        for (const x of Object.values(db.users)) { x.following = x.following.filter(f => f !== n); for (const l of x.lists || []) l.members = l.members.filter(f => f !== n); }
        db.messages = db.messages.filter(m => m.from !== n && m.to !== n);
        for (const r of db.rooms) { r.members = r.members.filter(x => x !== n); r.msgs = r.msgs.filter(m => m.from !== n); delete r.read[lc(n)]; if (r.owner === n) r.owner = r.members[0]; }
        db.rooms = db.rooms.filter(r => r.members.length >= 2); db.msgReports = db.msgReports.filter(r => r.by !== n && r.target !== n);
        db.drafts = db.drafts.filter(d => d.author !== n); db.media = (db.media || []).filter(m => m.owner !== n);
        db.reposts = db.reposts.filter(r => r.by !== n && !gone.has(r.postId));
        db.reports = db.reports.filter(r => r.by !== n && r.target !== n); db.appeals = (db.appeals || []).filter(a => a.user !== n); db.tickets = (db.tickets || []).filter(x => x.user !== n);
        for (const x of Object.values(db.users)) { if (x.blocked) x.blocked = x.blocked.filter(f => f !== n); if (x.muted) x.muted = x.muted.filter(f => f !== n); }
        db.notifs = db.notifs.filter(x => x.from !== n && x.to !== n && !gone.has(x.postId));
        delete db.users[n.toLowerCase()]; delete db.attempts[n.toLowerCase()];
    };
    const blockedBy = (author, target) => has((db.users[lc(target)] || {}).blocked, author);
    const ROOM_MAX = 8;
    // ajouter `t` à un groupe : ni l'un ni l'autre ne doit avoir bloqué l'autre ; le compte Streamer reste hors des groupes
    const roomOk = (me, t) => {
      need(!t.admin, 'Le compte Streamer ne peut pas être ajouté à un groupe');
      need(!blockedBy(me.name, t.name), `@${t.name} vous a bloqué : impossible de l’ajouter`);
      need(!has(me.blocked, t.name), `Débloquez @${t.name} pour l’ajouter`);
    };
    const vis = (by, list, get) => by ? list.filter(x => !hiddenFor(by, get(x))) : list;
    // idem pour les posts, avec en plus la confidentialité choisie par leur auteur (qui voit ses publications)
    const visP = (by, list, get) => vis(by, list, get).filter(x => privOk(db, by, get(x), 'posts'));
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
    const evt = eid => { const e = db.events.find(x => x.id === +eid); need(e, 'Événement introuvable'); return e; };
    const evVisible = (e, n) => { if (!e.group) return true; const g = db.groups.find(x => x.id === e.group); return !!g && canRead(g, n); };
    const cleanWarn = w => { w = String(w == null ? '' : w).replace(/\s+/g, ' ').trim(); need(w.length <= 100, 'Avertissement limité à 100 caractères'); return w; };
    const makePost = (author, text, replyTo, images, poll, group, warn) => {
        text = (text || '').trim(); const media = cleanMedia(images); images = cleanImages(images);
        need((text || images.length || media.length) && text.length <= 280, 'Message vide ou > 280 caractères');
        user(author); guard(author, true);
        let gid = group ? +group : null;
        if (replyTo) { const tp = db.posts.find(p => p.id === replyTo); need(tp, 'Post introuvable'); need(!blockedBy(author, tp.author), 'Cet utilisateur vous a bloqué : réponse impossible'); if (tp.group) gid = tp.group; }
        let g = null;
        if (gid) { g = grp(gid); need(isMember(g, author), 'Rejoignez la communauté pour y publier'); }
        const p = { id: id(), author: user(author).name, text, at: now(), likes: [], replyTo: replyTo || null };
        if (g) p.group = g.id;
        if (images.length) p.images = images;
        if (media.length) p.media = media;
        warn = cleanWarn(warn); if (warn) p.warn = warn;
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

    const cleanTag = t => { t = String(t || '').trim().toLowerCase(); if (t[0] !== '#') t = '#' + t; need(/^#\w{1,60}$/.test(t), 'Hashtag invalide'); return t; };
    const shareToken = () => randHex(12);
    const received = (by, o, l) => !!(l.share && ((db.users[lc(by)] || {}).sharedLists || []).some(r => lc(r.owner) === lc(o.name) && r.id === l.id && r.token === l.share));
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
      privacy: n => normPrivacy(user(n).privacy),
      setPrivacy(by, p) {
        p = p || {}; for (const k of ['profile', 'posts']) need(p[k] === undefined || PRIV_LEVELS.includes(p[k]), 'Réglage de confidentialité invalide');
        const u = user(by); u.privacy = normPrivacy(Object.assign({}, u.privacy, p)); save(); return u.privacy;
      },
      // suppression programmée : le compte reste intact pendant le délai de grâce et peut être rouvert (annulation) jusqu'à l'échéance
      async requestDeletion(by, password) {
        let u = user(by);
        need(!u.admin, 'Le compte Streamer ne peut pas être supprimé');
        need(!u.deleteAt, 'Suppression déjà programmée');
        need(u.pass.includes('$') && u.pass === await hashPw(password || '', u.pass.split('$')[0]), 'Mot de passe incorrect');
        load(); u = user(by); u.deleteAt = now() + GRACE_MS; save(); return u.deleteAt;
      },
      cancelDeletion(by) { const u = user(by); need(u.deleteAt, 'Aucune suppression programmée'); delete u.deleteAt; save(); },
      // comptes dont le délai de grâce est écoulé
      dueDeletions: () => Object.values(db.users).filter(u => u.deleteAt && u.deleteAt <= now() && !u.admin).map(u => u.name),
      finalizeDeletion(name) { const u = db.users[lc(name)]; if (u && u.deleteAt && u.deleteAt <= now() && !u.admin) { purge(u); save(); return true; } return false; },
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
      post(author, text, replyTo, images, poll, group, warn) { const p = makePost(author, text, replyTo, images, poll, group, warn); save(); return p; },
      // contenu sensible : avertissement (100 car. max) ajouté, modifié ou retiré à tout moment par l'auteur ; les médias sont floutés tant que le lecteur ne les révèle pas
      setWarning(by, postId, warn) {
        const p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable');
        need(p.author === user(by).name, 'Vous ne pouvez modifier que vos posts'); guard(by, true);
        warn = cleanWarn(warn); if (warn) p.warn = warn; else delete p.warn;
        save(); return p;
      },
      // posts épinglés : jusqu'à 3 publications de l'auteur (hors réponses et communautés) en haut de son profil, le dernier épinglé en premier
      togglePin(by, postId) {
        const u = user(by); guard(by);
        const p = db.posts.find(x => x.id === postId); need(p && p.author === u.name, 'Vous ne pouvez épingler que vos posts');
        const l = u.pinned = (u.pinned || []).filter(i => db.posts.some(x => x.id === i)), i = l.indexOf(postId);
        if (i >= 0) l.splice(i, 1);
        else { need(!p.replyTo && !p.group, 'Seules vos publications du profil peuvent être épinglées'); need(l.length < MAX_PINS, `${MAX_PINS} posts épinglés maximum : désépinglez-en un d’abord`); l.push(postId); }
        save(); return i < 0;
      },
      pinned: (n, by) => { const u = db.users[String(n || '').toLowerCase()]; if (!u) return []; return visP(by, (u.pinned || []).slice().reverse().map(i => db.posts.find(p => p.id === i && !p.replyTo && !p.group && p.author === u.name)).filter(Boolean), p => p.author); },
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
        for (const u of Object.values(db.users)) { if (u.bookmarks) u.bookmarks = u.bookmarks.filter(i => !gone.has(i)); if (u.pinned) u.pinned = u.pinned.filter(i => !gone.has(i)); }
        save();
      },
      // modification : auteur seulement, dans les 15 min ; l'ancien texte part dans l'historique
      editPost(by, postId, text) {
        const p = db.posts.find(x => x.id === postId); need(p, 'Post introuvable');
        need(p.author === user(by).name, 'Vous ne pouvez modifier que vos posts'); guard(by, true);
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
      // ---- médias envoyés : privés à leur propriétaire, quota de stockage, texte alternatif modifiable, suppression groupée ----
      media: by => (db.media || []).filter(m => lc(m.owner) === lc(by)).sort((a, b) => b.at - a.at || b.id - a.id),
      mediaUsage(by) { const l = this.media(by); return { used: l.reduce((a, m) => a + m.size, 0), quota: MEDIA_QUOTA, count: l.length, saved: l.reduce((a, m) => a + Math.max(0, m.orig - m.size), 0) }; },
      mediaSrc(by, mid) { const m = (db.media || []).find(x => x.id === +mid && lc(x.owner) === lc(by)); need(m, 'Média introuvable'); return m.src; },
      addMedia(by, f) {
        const u = user(by); guard(u.name, true); f = f || {}; db.media = db.media || [];
        const src = String(f.src || ''), thumb = String(f.thumb || '');
        need(IMG_RE.test(src), 'Image invalide (JPEG, PNG, WebP ou GIF)'); need(src.length <= MAX_IMG_CHARS, 'Image trop lourde');
        need(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(thumb) && thumb.length <= MAX_THUMB_CHARS, 'Miniature invalide');
        need(db.media.filter(m => m.owner === u.name).length < MAX_MEDIA, `${MAX_MEDIA} médias maximum`);
        const size = b64Bytes(src) + b64Bytes(thumb), used = db.media.filter(m => m.owner === u.name).reduce((a, m) => a + m.size, 0);
        need(used + size <= MEDIA_QUOTA, 'Quota de stockage dépassé : supprimez des médias');
        const m = { id: id(), owner: u.name, name: String(f.name || 'image').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) || 'image', src, thumb, alt: String(f.alt || '').trim().slice(0, 200), size, orig: Math.max(size, Math.min(Math.floor(+f.orig) || size, 200 * 1024 * 1024)), w: Math.min(10000, Math.max(0, Math.floor(+f.w) || 0)), h: Math.min(10000, Math.max(0, Math.floor(+f.h) || 0)), at: now() };
        db.media.push(m); save(); return { id: m.id };
      },
      setMediaAlt(by, mid, alt) { const m = (db.media || []).find(x => x.id === +mid && lc(x.owner) === lc(user(by).name)); need(m, 'Média introuvable'); m.alt = String(alt || '').trim().slice(0, 200); save(); return m.alt; },
      // supprime plusieurs médias d'un coup (ceux qui ne sont pas à vous sont ignorés) ; renvoie le nombre supprimé
      deleteMedia(by, ids) {
        const u = user(by); need(Array.isArray(ids), 'Sélection invalide'); const set = new Set(ids.map(Number)), before = (db.media || []).length;
        db.media = (db.media || []).filter(m => !(m.owner === u.name && set.has(m.id))); save(); return before - db.media.length;
      },
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
        let n = (api.closePolls() ? 1 : 0) + api.sendReminders(), changed = false;
        for (const d of db.drafts.slice()) {
          if (!d.scheduledAt || d.scheduledAt > now()) continue;
          try { makePost(d.author, d.text, null, d.images); db.drafts = db.drafts.filter(x => x !== d); n++; }
          catch (e) { d.scheduledAt = null; d.failed = 'Publication planifiée échouée : ' + e.message; changed = true; }
        }
        if (n || changed) save();
        return n;
      },
      // ---- événements : date, lieu, communauté facultative ; réponses « Je viens / Peut-être / Non » ; rappel avant le début ----
      createEvent(by, o) {
        const u = user(by); guard(by, true); o = o || {};
        const title = String(o.title || '').trim().replace(/\s+/g, ' '), place = String(o.place || '').trim(), desc = String(o.desc || '').trim(), start = Math.round(+o.start), remind = o.remind === undefined ? 60 : Math.round(+o.remind);
        need(title.length >= 3 && title.length <= 80, 'Titre : 3 à 80 caractères'); need(place.length <= 120, 'Lieu : 120 caractères max'); need(desc.length <= 500, 'Description : 500 caractères max');
        need(Number.isFinite(start) && start > now() - 60000, 'La date doit être dans le futur'); need(start < now() + MAX_AHEAD_MS, 'Date trop lointaine (1 an maximum)');
        need(Number.isFinite(remind) && EV_REMINDS.includes(remind), 'Rappel invalide');
        need(db.events.filter(e => lc(e.owner) === lc(u.name) && e.start > now()).length < MAX_EVENTS, `${MAX_EVENTS} événements à venir maximum par compte`);
        let gid = null; if (o.group) { const g = grp(o.group); need(isMember(g, u.name), 'Rejoignez la communauté pour y créer un événement'); gid = g.id; }
        const e = { id: id(), title, desc, place, start, remind, group: gid, owner: u.name, rsvps: { [lc(u.name)]: 'yes' }, reminded: [], at: now() };
        db.events.push(e); save(); return e;
      },
      updateEvent(by, eid, o) {
        const e = evt(eid); need(lc(e.owner) === lc(user(by).name) || api.isAdmin(by), 'Réservé à l’organisateur'); o = o || {};
        if (o.title !== undefined) { const v = String(o.title).trim().replace(/\s+/g, ' '); need(v.length >= 3 && v.length <= 80, 'Titre : 3 à 80 caractères'); e.title = v; }
        if (o.place !== undefined) { const v = String(o.place).trim(); need(v.length <= 120, 'Lieu : 120 caractères max'); e.place = v; }
        if (o.desc !== undefined) { const v = String(o.desc).trim(); need(v.length <= 500, 'Description : 500 caractères max'); e.desc = v; }
        if (o.remind !== undefined) { need(EV_REMINDS.includes(+o.remind), 'Rappel invalide'); e.remind = +o.remind; e.reminded = []; }
        if (o.start !== undefined) { const v = Math.round(+o.start); need(Number.isFinite(v) && v > now() - 60000 && v < now() + MAX_AHEAD_MS, 'Date invalide'); e.start = v; e.reminded = []; for (const n of Object.keys(e.rsvps)) if (n !== lc(e.owner)) notify(db.users[n] && db.users[n].name, e.owner, 'event', null, { event: e.id, what: 'moved', title: e.title, start: e.start }); }
        save(); return e;
      },
      deleteEvent(by, eid) {
        const e = evt(eid); need(lc(e.owner) === lc(user(by).name) || api.isAdmin(by), 'Réservé à l’organisateur');
        for (const n of Object.keys(e.rsvps)) if (n !== lc(e.owner) && db.users[n]) notify(db.users[n].name, e.owner, 'event', null, { event: e.id, what: 'cancelled', title: e.title, start: e.start });
        db.events = db.events.filter(x => x !== e); save();
      },
      // réponse : yes | maybe | no ; null retire la réponse
      rsvp(by, eid, answer) {
        const u = user(by), e = evt(eid); guard(by); need(evVisible(e, u.name), 'Événement introuvable');
        need(answer === null || answer === undefined || EV_ANSWERS.includes(answer), 'Réponse invalide');
        need(e.start > now(), 'Cet événement est terminé'); const k = lc(u.name);
        if (answer === null || answer === undefined) delete e.rsvps[k]; else e.rsvps[k] = answer;
        e.reminded = e.reminded.filter(x => x !== k);
        if (answer && k !== lc(e.owner)) notify(e.owner, u.name, 'event', null, { event: e.id, what: answer, title: e.title, start: e.start });
        save(); return answer || null;
      },
      evt: (by, eid) => { const e = evt(eid); need(evVisible(e, by), 'Événement introuvable'); return e; },
      // événements visibles par `by` (public, ou communauté lisible), à venir d'abord ; `past` ajoute les terminés
      events(by, past) { return db.events.filter(e => evVisible(e, by) && (past || e.start + EV_GRACE > now())).sort((a, b) => a.start - b.start); },
      // agenda personnel : événements organisés ou auxquels on a répondu « Je viens » / « Peut-être »
      agenda(by, past) { const k = lc(by); return api.events(by, past).filter(e => lc(e.owner) === k || e.rsvps[k] === 'yes' || e.rsvps[k] === 'maybe'); },
      evCounts: e => { const c = { yes: 0, maybe: 0, no: 0 }; for (const v of Object.values(e.rsvps)) c[v]++; return c; },
      myRsvp: (by, e) => e.rsvps[lc(by)] || null,
      // export iCal (RFC 5545) de l'agenda de `by`
      ical(by) { return ics(api.agenda(by, true), by); },
      // appelée par l'horloge du serveur : rappel (notification) aux inscrits « Je viens » / « Peut-être » quand l'heure du rappel est arrivée
      sendReminders() {
        let n = 0;
        for (const e of db.events) {
          if (e.start <= now() || e.start - e.remind * 60000 > now()) continue;
          for (const [k, a] of Object.entries(e.rsvps)) {
            if ((a !== 'yes' && a !== 'maybe') || e.reminded.includes(k) || !db.users[k]) continue;
            e.reminded.push(k); db.notifs.push({ id: id(), to: db.users[k].name, from: '', type: 'event', postId: null, at: now(), read: false, event: e.id, what: 'reminder', title: e.title, start: e.start }); n++;
          }
        }
        if (n) save(); return n;
      },
      // supprime les événements terminés depuis plus de 30 jours
      purgeEvents() { const k = db.events.length; db.events = db.events.filter(e => e.start + 30 * 86400000 > now()); if (db.events.length !== k) save(); return k - db.events.length; },
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
        const x = { id: id(), name, public: !!isPublic, share: null, members: [], at: now() }; l.push(x); save(); return x;
      },
      updateList(by, listId, o) {
        const l = ownList(by, listId); o = o || {};
        if (o.name !== undefined) {
          const name = String(o.name).trim().replace(/\s+/g, ' '); need(name.length >= 1 && name.length <= 40, 'Nom de liste : 1 à 40 caractères');
          need(!user(by).lists.some(x => x !== l && lc(x.name) === lc(name)), 'Vous avez déjà une liste de ce nom'); l.name = name;
        }
        if (o.public !== undefined) l.public = !!o.public;
        if (o.share !== undefined) l.share = o.share ? (l.share && o.share !== 'renew' ? l.share : shareToken()) : null;   // lien de partage : true/'renew' le (re)crée, false le révoque
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
      lists: (owner, by) => { const o = db.users[lc(owner)]; return o ? (o.lists || []).filter(l => l.public || lc(o.name) === lc(by) || received(by, o, l)).map(l => lc(o.name) === lc(by) ? l : Object.assign({}, l, { share: null })) : []; },
      // listes reçues par lien : ouvrir un lien valide l'enregistre chez le visiteur (jeton vérifié) ; renvoie la liste
      saveSharedList(by, owner, listId, token) {
        const u = user(by), o = db.users[lc(owner)], l = o && (o.lists || []).find(x => x.id === +listId);
        need(l && l.share && l.share === String(token), 'Lien de liste invalide ou révoqué');
        if (lc(o.name) !== lc(u.name) && !received(by, o, l)) { const r = u.sharedLists = u.sharedLists || []; need(r.length < 50, '50 listes reçues maximum'); r.push({ owner: o.name, id: l.id, token: l.share }); save(); }
        return { owner: o.name, id: l.id };
      },
      forgetSharedList(by, owner, listId) { const u = user(by); u.sharedLists = (u.sharedLists || []).filter(r => !(lc(r.owner) === lc(owner) && r.id === +listId)); save(); },
      sharedLists: by => ((db.users[lc(by)] || {}).sharedLists || []).map(r => { const o = db.users[lc(r.owner)], l = o && (o.lists || []).find(x => x.id === r.id && x.share === r.token); return l ? { owner: o.name, list: Object.assign({}, l, { share: null }) } : null; }).filter(Boolean),
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
        return visP(by, own.concat(rt), x => x.post.author).filter(x => !x.by || !hiddenFor(by, x.by)).sort((a, b) => b.at - a.at);
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
      explore: by => visP(by, db.posts.filter(p => !p.replyTo && !p.group), p => p.author).sort((a, b) => b.id - a.id),
      replies: (postId, by) => visP(by, db.posts.filter(p => p.replyTo === postId), p => p.author).sort((a, b) => a.id - b.id),
      byUser: (n, by) => visP(by, db.posts.filter(p => !p.replyTo && !p.group && p.author.toLowerCase() === n.toLowerCase()), p => p.author).sort((a, b) => b.id - a.id),
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
          posts: visP(by, db.posts.filter(p => !p.group && p.text.toLowerCase().includes(q)), p => p.author).sort((a, b) => b.id - a.id),
        };
      },
      // recherche plein texte (FTS5, voir store.js) : ne garde que ce que `by` a le droit de voir (hors communautés, posts masqués, comptes bloqués / masqués, confidentialité)
      ftsVisible(by, ids) {
        const m = new Map(db.posts.map(p => [p.id, p]));
        return ids.filter(i => { const p = m.get(i); return p && !p.group && !p.hidden && visP(by, [p], x => x.author).length; });
      },
      ftsMembers(by, names) {
        return names.map(n => db.users[lc(n)]).filter(u => u && vis(by, [u], x => x.name).length)
          .map(u => ({ name: u.name, display: privOk(db, by, u.name, 'profile') ? u.display || '' : '', bio: privOk(db, by, u.name, 'profile') ? u.bio || '' : '' }));
      },
      // ---- recherche avancée : « de:@pseudo », « depuis:AAAA-MM-JJ », « avant:AAAA-MM-JJ », « avec:image », « avec:sondage », « tri:populaire » ----
      parseSearch(raw) {
        const o = { text: '', from: null, since: null, until: null, image: false, poll: false, sort: 'recent' }, rest = [];
        const day = (v, end) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); if (!m) return null; const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime(); return isNaN(t) ? null : t + (end ? 86400000 : 0); };
        for (const w of String(raw || '').split(/\s+/).filter(Boolean)) {
          const m = /^(de|from|depuis|since|avant|until|avec|with|tri|sort):(.*)$/i.exec(w); if (!m) { rest.push(w); continue; }
          const k = m[1].toLowerCase(), v = m[2].replace(/^@/, '').toLowerCase();
          if (k === 'de' || k === 'from') o.from = v || null;
          else if (k === 'depuis' || k === 'since') o.since = day(v, false);
          else if (k === 'avant' || k === 'until') o.until = day(v, true);
          else if (k === 'avec' || k === 'with') { if (v === 'image' || v === 'images') o.image = true; else if (v === 'sondage' || v === 'poll') o.poll = true; }
          else o.sort = /^(populaire|popular|top)$/.test(v) ? 'popular' : 'recent';
        }
        o.text = rest.join(' ').toLowerCase(); return o;
      },
      // résultats d'une recherche avancée (chaîne avec opérateurs ou objet déjà analysé) ; sort force le tri
      find(raw, by, sort) {
        const o = typeof raw === 'string' ? api.parseSearch(raw) : raw; if (sort) o.sort = sort;
        const any = o.text || o.from || o.since != null || o.until != null || o.image || o.poll;
        if (!any) return { users: [], posts: [] };
        let posts = visP(by, db.posts.filter(p => !p.group && !p.hidden
          && (!o.text || p.text.toLowerCase().includes(o.text))
          && (!o.from || lc(p.author) === o.from)
          && (o.since == null || p.at >= o.since) && (o.until == null || p.at < o.until)
          && (!o.image || (p.images && p.images.length)) && (!o.poll || p.poll)), p => p.author);
        const pop = p => p.likes.length * 2 + db.posts.filter(r => r.replyTo === p.id).length * 3;
        posts = o.sort === 'popular' ? posts.map(p => [p, pop(p)]).sort((a, b) => b[1] - a[1] || b[0].id - a[0].id).map(x => x[0]) : posts.sort((a, b) => b.id - a.id);
        const users = o.text && !o.from && !o.since && !o.until && !o.image && !o.poll ? vis(by, Object.values(db.users).filter(u => u.name.toLowerCase().includes(o.text)), u => u.name) : [];
        return { users, posts };
      },
      // recherches enregistrées (menu) : { id, name, q, sort, seen, notified } ; fresh = nouveaux résultats depuis la dernière visite
      searches(by) {
        const u = user(by);
        return (u.searches || []).map(s => ({ id: s.id, name: s.name, q: s.q, sort: s.sort, ...(r => ({ fresh: r.filter(p => p.id > s.seen).length, alert: r.filter(p => p.id > s.notified).length }))(api.find(s.q, by, s.sort).posts.filter(p => lc(p.author) !== lc(by))) }));
      },
      saveSearch(by, q, sort, name) {
        q = String(q || '').trim().slice(0, 200); const o = api.parseSearch(q); // les appels internes relisent le storage : on ne garde aucune référence avant
        need(o.text || o.from || o.since != null || o.until != null || o.image || o.poll, 'Recherche vide');
        const u = user(by); guard(by);
        const l = u.searches = u.searches || []; need(l.length < 20, '20 recherches enregistrées maximum');
        sort = sort === 'popular' ? 'popular' : 'recent';
        const dup = l.find(s => s.q === q && s.sort === sort); if (dup) return dup;
        const top = db.posts.reduce((m, p) => Math.max(m, p.id), 0);
        const s = { id: id(), name: String(name || q).trim().slice(0, 40) || q, q, sort, seen: top, notified: top }; l.push(s); save(); return s;
      },
      deleteSearch(by, sid) { const u = user(by); u.searches = (u.searches || []).filter(s => s.id !== sid); save(); },
      // ouvre une recherche enregistrée : remet son badge à zéro
      markSearchSeen(by, sid) {
        const s = (user(by).searches || []).find(x => x.id === sid); if (!s) return;
        const top = db.posts.reduce((m, p) => Math.max(m, p.id), 0); if (s.seen === top && s.notified >= top) return;
        s.seen = top; s.notified = Math.max(s.notified, top); save();
      },
      // alertes : une notification par recherche enregistrée ayant de nouveaux résultats depuis la dernière alerte ; renvoie le nombre créé
      checkSearches(by) {
        const found = api.searches(by).filter(s => s.alert).map(s => [s.id, api.find(s.q, by, s.sort).posts.filter(p => lc(p.author) !== lc(by))]);
        const u = user(by); let n = 0;
        for (const [sid, posts] of found) {
          const s = (u.searches || []).find(x => x.id === sid), fresh = s ? posts.filter(p => p.id > s.notified) : []; if (!fresh.length) continue;
          s.notified = Math.max(...fresh.map(p => p.id));
          db.notifs.push({ id: id(), to: u.name, from: '', type: 'search', postId: fresh[0].id, at: now(), read: false, search: s.id, name: s.name, count: fresh.length }); n++;
        }
        if (n) save(); return n;
      },
      // ---- préférences de notifications ----
      notifPrefs(by) { return normPrefs(user(by).notifPrefs); },
      setNotifPrefs(by, p) {
        const u = user(by), old = normPrefs(u.notifPrefs), n = normPrefs(p);
        need(p && typeof p === 'object', 'Préférences invalides');
        if (n.quiet.on) need(hhmm(p.quiet && p.quiet.from) && hhmm(p.quiet.to), 'Heures calmes invalides (HH:MM)');
        const mailOn = x => NP_TYPES.some(t => x.types[t].email);
        n.since = mailOn(n) ? (mailOn(old) && old.since ? old.since : now()) : 0; // seuls les événements postérieurs à l'activation partent par e-mail
        n.last = old.last; if (n.digest.on && !old.digest.on) n.last = 0;
        u.notifPrefs = n; save(); return n;
      },
      // travail d'envoi pour le serveur : e-mails immédiats (hors heures calmes) et résumé quotidien ; marque ce qui part, renvoie [{ to, subject, text }]
      mailJobs(base, at) {
        at = at || now(); const jobs = [], link = (base || '') + '/?notif=1'; let dirty = false;
        for (const u of Object.values(db.users)) {
          if (!u.email) continue;
          const p = normPrefs(u.notifPrefs), mine = db.notifs.filter(n => n.to === u.name && !n.read && !n.mailed && !hiddenFor(u.name, n.from));
          const line = n => `• ${n.from ? '@' + n.from + ' ' : ''}${NP_LABEL[n.type] || n.type}${n.count > 1 ? ' (×' + n.count + ')' : ''}`;
          const live = p.since ? mine.filter(n => NP_TYPES.includes(n.type) && p.types[n.type].email && n.at >= p.since) : [];
          if (live.length && !inQuiet(p, at)) {
            live.forEach(n => (n.mailed = true)); dirty = true;
            jobs.push({ to: u.email, subject: `Cornichon : ${live.length} nouvelle${live.length > 1 ? 's' : ''} notification${live.length > 1 ? 's' : ''}`, text: `Bonjour @${u.name},\n\n${live.map(line).join('\n')}\n\nOuvrir Cornichon : ${link}\n\nVos préférences : onglet « Alertes » de l'appli.` });
          }
          if (p.digest.on) {
            const today = Math.floor((at / 60000 - p.tz) / 1440), lastDay = p.last ? Math.floor((p.last / 60000 - p.tz) / 1440) : -1;
            if (lastDay < today && localMin(at, p.tz) >= p.digest.hour * 60 && !inQuiet(p, at)) {
              const missed = mine.filter(n => n.at > Math.max(p.last, at - 86400000) && !(n.mailed));
              u.notifPrefs = Object.assign({}, p, { last: at }); dirty = true;
              if (missed.length) {
                missed.forEach(n => (n.mailed = true));
                const by = {}; for (const n of missed) by[n.type] = (by[n.type] || 0) + (n.count || 1);
                jobs.push({ to: u.email, subject: `Cornichon : votre résumé du jour (${missed.length} activité${missed.length > 1 ? 's' : ''} manquée${missed.length > 1 ? 's' : ''})`, text: `Bonjour @${u.name},\n\nVoici ce que vous avez manqué :\n${Object.entries(by).map(([t, c]) => `• ${c} × ${NP_LABEL[t] || t}`).join('\n')}\n\nDétail :\n${missed.slice(-15).map(line).join('\n')}\n\nOuvrir Cornichon : ${link}` });
              }
            }
          }
        }
        if (dirty) save(); return jobs;
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
        return visP(by, db.posts.filter(p => !p.replyTo && !p.group), p => p.author).map(p => ({ post: p, score: scoreOf(p) })).sort((a, b) => b.score - a.score).slice(0, limit || 5);
      },
      // hashtags du moment : score = somme des scores des posts qui les contiennent
      trendingLive(limit) {
        const c = {};
        for (const p of db.posts) if (!p.group) for (const t of new Set((p.text.match(/#\w+/g) || []).map(x => x.toLowerCase()))) { const e = c[t] || (c[t] = { tag: t, count: 0, score: 0 }); e.count++; e.score += scoreOf(p); }
        return Object.values(c).sort((a, b) => b.score - a.score).slice(0, limit || 8);
      },
      // ---- sujets (#hashtags) : fil d'un sujet, tendances sur 24 h / 7 j, abonnement personnel ----
      // posts (racines et réponses) contenant le hashtag, récents d'abord
      tagFeed(tag, by) {
        tag = cleanTag(tag);
        return visP(by, db.posts.filter(p => !p.group && !p.hidden && (p.text.toLowerCase().match(/#\w+/g) || []).includes(tag)), p => p.author).sort((a, b) => b.at - a.at);
      },
      // sujets les plus actifs sur une fenêtre (24h | 7d) : posts, auteurs distincts, interactions
      trendingTopics(range, by, limit) {
        const span = range === '7d' ? 7 * 86400000 : 86400000, since = now() - span, c = {};
        for (const p of visP(by, db.posts.filter(x => !x.group && !x.hidden && x.at >= since), x => x.author)) {
          const weight = 1 + p.likes.length * 2 + db.posts.filter(r => r.replyTo === p.id).length * 3;
          for (const t of new Set((p.text.toLowerCase().match(/#\w+/g) || []))) { const e = c[t] || (c[t] = { tag: t, count: 0, authors: new Set(), score: 0 }); e.count++; e.authors.add(p.author); e.score += weight; }
        }
        return Object.values(c).map(e => ({ tag: e.tag, count: e.count, authors: e.authors.size, score: e.score + e.authors.size }))
          .sort((a, b) => b.score - a.score || b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit || 10);
      },
      // posts les plus actifs de la fenêtre (racines) : likes + réponses
      trendingPosts(range, by, limit) {
        const span = range === '7d' ? 7 * 86400000 : 86400000, since = now() - span;
        return visP(by, db.posts.filter(p => !p.replyTo && !p.group && !p.hidden && p.at >= since), p => p.author)
          .map(p => ({ post: p, likes: p.likes.length, replies: db.posts.filter(r => r.replyTo === p.id).length }))
          .map(r => Object.assign(r, { score: r.likes * 2 + r.replies * 3 }))
          .sort((a, b) => b.score - a.score || b.post.at - a.post.at).slice(0, limit || 6);
      },
      topics: by => ((db.users[lc(by)] || {}).topics || []).slice(),
      isTopic: (by, tag) => ((db.users[lc(by)] || {}).topics || []).includes(String(tag || '').toLowerCase()),
      // s'abonner / se désabonner d'un sujet ; renvoie true si abonné
      toggleTopic(by, tag) {
        const u = user(by); tag = cleanTag(tag); guard(by);
        const l = u.topics = u.topics || [], i = l.indexOf(tag);
        if (i >= 0) l.splice(i, 1); else { need(l.length < 50, '50 sujets suivis maximum'); l.push(tag); }
        save(); return i < 0;
      },
      // ---- fil « Pour vous » : classé par pertinence (affinités, interactions, sujets suivis), avec mots masqués, « moins de ça » et explication ----
      fyPrefs(by) {
        const f = (db.users[lc(by)] || {}).fy || {};
        return { words: (f.words || []).slice(), less: (f.less || []).slice(), lessAuthors: Object.assign({}, f.lessAuthors), lessTags: Object.assign({}, f.lessTags) };
      },
      addMutedWord(by, w) {
        const u = user(by); guard(by); w = String(w || '').trim().replace(/\s+/g, ' ').slice(0, 60); need(w.length >= 2, 'Mot ou expression trop court (2 caractères minimum)');
        const f = u.fy = u.fy || {}, l = f.words = f.words || [];
        need(l.length < MAX_FY_WORDS, MAX_FY_WORDS + ' mots masqués maximum');
        if (!l.some(x => fyNorm(x) === fyNorm(w))) l.push(w);
        save(); return l.slice();
      },
      removeMutedWord(by, w) {
        const u = user(by), f = u.fy = u.fy || {}; f.words = (f.words || []).filter(x => fyNorm(x) !== fyNorm(w)); save(); return f.words.slice();
      },
      // « moins de ça » : écarte le post et baisse l'auteur et les sujets ; un second appel annule
      toggleLess(by, postId) {
        const u = user(by); guard(by); const p = db.posts.find(x => x.id === +postId); need(p && !p.replyTo, 'Post introuvable');
        const f = u.fy = u.fy || {}, l = f.less = f.less || [], la = f.lessAuthors = f.lessAuthors || {}, lt = f.lessTags = f.lessTags || {}, i = l.indexOf(p.id), a = lc(p.author), tags = fyTags(p), d = i >= 0 ? -1 : 1;
        if (i >= 0) l.splice(i, 1); else l.push(p.id);
        if (l.length > 200) l.shift();
        if (a !== lc(u.name)) { la[a] = Math.max(0, (la[a] || 0) + d); if (!la[a]) delete la[a]; }
        for (const t of tags) { lt[t] = Math.max(0, (lt[t] || 0) + d); if (!lt[t]) delete lt[t]; }
        save(); return d > 0;
      },
      resetLess(by) { const u = user(by), f = u.fy = u.fy || {}; f.less = []; f.lessAuthors = {}; f.lessTags = {}; save(); },
      // posts classés avec les raisons de leur présence : [{ post, score, reasons: [texte] }]
      forYou(by) {
        const me = user(by), fy = me.fy || {}, words = fy.words || [], less = new Set(fy.less || []), la = fy.lessAuthors || {}, lt = fy.lessTags || {};
        const folk = new Set((me.following || []).map(lc)), topics = new Set(me.topics || []), mine = lc(me.name), t0 = now();
        const aff = Object.create(null), bump = (n, v) => { n = lc(n); aff[n] = (aff[n] || 0) + v; };
        const byId = new Map(db.posts.map(p => [p.id, p]));
        for (const p of db.posts) {
          if (p.likes.includes(me.name)) bump(p.author, 1);
          if (lc(p.author) === mine && p.replyTo) { const t = byId.get(p.replyTo); if (t) bump(t.author, 2); }
        }
        for (const r of db.reposts) if (r.by === me.name) { const t = byId.get(r.postId); if (t) bump(t.author, 1.5); }
        for (const m of db.messages) { if (lc(m.from) === mine) bump(m.to, 0.5); }
        const rc = {}; for (const p of db.posts) if (p.replyTo) rc[p.replyTo] = (rc[p.replyTo] || 0) + 1;
        const cand = visP(by, db.posts.filter(p => !p.replyTo && !p.group && !p.hidden && lc(p.author) !== mine && !less.has(p.id) && !fyMuted(p, words)), p => p.author);
        return cand.map(p => {
          const a = lc(p.author), tags = fyTags(p), reasons = []; let s = 0;
          if (folk.has(a)) { s += 3; reasons.push('Vous suivez @' + p.author); }
          if (aff[a]) { const v = Math.min(4, aff[a]); s += v; reasons.push(`Vous interagissez souvent avec @${p.author} (${Math.round(aff[a])} interaction${aff[a] >= 2 ? 's' : ''})`); }
          const tm = tags.filter(t => topics.has(t)); if (tm.length) { s += 3 * tm.length; reasons.push('Sujet suivi : ' + tm.join(', ')); }
          const fl = p.likes.filter(n => folk.has(lc(n)) && lc(n) !== a); if (fl.length) { s += Math.min(3, fl.length * 1.5); reasons.push('Aimé par @' + fl[0] + (fl.length > 1 ? ' et ' + (fl.length - 1) + ' autre' + (fl.length > 2 ? 's' : '') + ' de vos abonnements' : ' (vous le suivez)')); }
          const pop = p.likes.length + (rc[p.id] || 0) * 2; if (pop >= 2) { s += Math.min(2, Math.log2(1 + pop) / 2); reasons.push('Populaire en ce moment (' + p.likes.length + ' like' + (p.likes.length > 1 ? 's' : '') + ', ' + (rc[p.id] || 0) + ' réponse' + ((rc[p.id] || 0) > 1 ? 's' : '') + ')'); }
          const pen = (la[a] || 0) * 2 + tags.reduce((x, t) => x + (lt[t] || 0) * 1.5, 0); if (pen) { s -= pen; reasons.push('Réduit car vous avez demandé moins de contenu similaire'); }
          const h = Math.max(0, t0 - p.at) / 36e5; s = (s + 0.5) * Math.pow(0.5, h / 24);
          if (!reasons.length) reasons.push('Récent dans la communauté');
          return { post: p, score: Math.round(s * 1000) / 1000, reasons };
        }).filter(x => x.score > 0.001).sort((a, b) => b.score - a.score || b.post.id - a.post.id);
      },
      // pourquoi ce post est proposé ?
      whyShown(by, postId) { const r = api.forYou(by).find(x => x.post.id === +postId); return r ? r.reasons : ['Ce post n’est pas dans « Pour vous » (il est dans votre fil chronologique ou a été écarté).']; },
      // applique les mots masqués d'un compte à une liste de posts (fils chronologique et Explorer)
      fyFilter(by, posts) { const w = ((db.users[lc(by)] || {}).fy || {}).words || []; return w.length ? posts.filter(p => lc(p.author) === lc(by) || !fyMuted(p, w)) : posts; },
      // fil des sujets suivis
      topicsFeed(by) {
        const t = new Set(api.topics(by));
        return visP(by, db.posts.filter(p => !p.group && !p.hidden && !p.replyTo && (p.text.toLowerCase().match(/#\w+/g) || []).some(x => t.has(x))), p => p.author).sort((a, b) => b.at - a.at).slice(0, 50);
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
        const photo = f.photo === undefined ? u.photo || '' : String(f.photo);
        need(photo.length <= 80000 && (!photo || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(photo)), 'Photo invalide (JPEG, PNG ou WebP, 60 Ko max)');
        Object.assign(u, { display, bio, avatar, banner, link, photo });
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
          privacy: normPrivacy(u.privacy), deleteAt: u.deleteAt || null, blocked: (u.blocked || []).slice(), muted: (u.muted || []).slice(), bookmarks: (u.bookmarks || []).slice(), lists: JSON.parse(JSON.stringify(u.lists || [])),
          likes: db.posts.filter(p => p.likes.includes(u.name)).map(p => p.id), notifPrefs: u.notifPrefs || null,
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
        text = (text || '').trim(); const media = cleanMedia(images); images = cleanImages(images);
        need((text || images.length || media.length) && text.length <= 500, 'Message invalide');
        user(from); guard(from, true); const t = user(to);
        need(!blockedBy(from, to), 'Cet utilisateur vous a bloqué : message impossible');
        need(!has(user(from).blocked, to), 'Débloquez cet utilisateur pour lui écrire');
        const m = { id: id(), from: user(from).name, to: t.name, text, at: now() };
        if (images.length) m.images = images;
        if (media.length) m.media = media;
        db.messages.push(m);
        // entrée « dm » (une par expéditeur tant qu'elle n'est pas lue) : visible dans la cloche selon les préférences, base des e-mails et du résumé
        const open = db.notifs.find(n => n.type === 'dm' && n.to === t.name && n.from === m.from && !n.read);
        if (open) { open.count = (open.count || 1) + 1; open.at = m.at; } else if (t.name !== m.from) db.notifs.push({ id: id(), to: t.name, from: m.from, type: 'dm', postId: null, at: m.at, read: false, count: 1 });
        save();
      },
      // historique des appels audio/vidéo : une ligne dans la conversation (manqué, refusé, terminé) ; l'appel manqué alerte comme un message
      logCall(from, to, kind, status, secs) {
        need(['audio', 'video'].includes(kind) && ['missed', 'declined', 'ended'].includes(status), 'Appel invalide');
        const f = user(from), t = user(to); secs = Math.max(0, Math.min(86400, Math.round(+secs) || 0));
        const label = { audio: 'audio', video: 'vidéo' }[kind], m = { id: id(), from: f.name, to: t.name, at: now(), call: { kind, status, secs } };
        m.text = status === 'missed' ? `📞 Appel ${label} manqué` : status === 'declined' ? `📞 Appel ${label} refusé` : `📞 Appel ${label} · ${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')} s`;
        db.messages.push(m);
        if (status === 'missed') { const open = db.notifs.find(n => n.type === 'dm' && n.to === t.name && n.from === f.name && !n.read); if (open) { open.count = (open.count || 1) + 1; open.at = m.at; } else db.notifs.push({ id: id(), to: t.name, from: f.name, type: 'dm', postId: null, at: m.at, read: false, count: 1 }); }
        save(); return m;
      },
      // ---- messages non lus : curseur « dernier message lu » par interlocuteur, stocké sur le compte ----
      markDmRead(by, peer) {
        const me = user(by), t = user(peer), k = lc(t.name);
        const last = db.messages.filter(m => m.from === t.name && m.to === me.name).reduce((a, m) => Math.max(a, m.id), 0);
        const r = me.dmRead = me.dmRead || {};
        if ((r[k] || 0) >= last) return false;
        r[k] = last; for (const n of db.notifs) if (n.type === 'dm' && n.to === me.name && lc(n.from) === k) n.read = true; save(); return true;
      },
      // { total, peers: { pseudo: n } } : messages reçus après le curseur de lecture, hors comptes bloqués/masqués
      unreadDm(by) {
        const me = user(by), r = me.dmRead || {}, peers = {}; let total = 0;
        for (const m of db.messages) if (m.to === me.name && m.id > (r[lc(m.from)] || 0) && m.id > (((me.dmCleared || {})[lc(m.from)]) || 0) && !hiddenFor(by, m.from)) { peers[m.from] = (peers[m.from] || 0) + 1; total++; }
        const rooms = {};
        for (const r of db.rooms) if (has(r.members, me.name)) { const seen = r.read[lc(me.name)] || 0, n = r.msgs.filter(m => m.from !== me.name && m.id > seen && !hiddenFor(by, m.from)).length; if (n) { rooms[r.id] = n; total += n; } }
        return { total, peers, rooms };
      },
      // pagination par curseur (id décroissant) : scope « feed » (abonnements) ou « explore » ; `after` compte les posts plus récents
      page(by, scope, o) {
        o = o || {};
        if (scope === 'search' || scope === 'notifs' || scope === 'convs' || scope === 'dm') return api.pageIds(by, scope, o);
        if (scope === 'foryou') {
          const ids = api.forYou(by).map(x => x.post.id), limit = Math.min(50, Math.max(1, +o.limit || 10));
          if (o.after) return { count: ids.filter(i => i > +o.after).length };
          const k = o.before ? ids.indexOf(+o.before) : -1, rest = k < 0 ? ids : ids.slice(k + 1);
          return { posts: rest.slice(0, limit).map(id => ({ id })), more: rest.length > limit, total: ids.length };
        }
        const all = scope === 'feed' ? api.fyFilter(by, api.feed(by)) : scope === 'explore' ? api.fyFilter(by, api.explore(by)) : scope === 'group' ? api.groupFeed(by, +o.group) : scope === 'list' ? api.listFeed(by, o.owner, +o.list) : api.explore(by), limit = Math.min(50, Math.max(1, +o.limit || 10));
        if (o.after) return { count: all.filter(p => p.id > +o.after).length };
        const rest = o.before ? all.filter(p => p.id < +o.before) : all;
        return { posts: rest.slice(0, limit), more: rest.length > limit, total: all.length };
      },
      // pagination par curseur des recherches, notifications, conversations et messages : renvoie des identifiants (le client a déjà les objets)
      // search : ?q=&sort= ; notifs ; convs (clé = id du dernier message) ; dm : ?peer= (du plus récent au plus ancien)
      pageIds(by, scope, o) {
        const limit = Math.min(50, Math.max(1, +o.limit || 10)), sortedById = !(scope === 'search' && /^popular$/.test(o.sort || ''));
        let all, users = [];
        if (scope === 'search') { const r = api.find(String(o.q || ''), by, o.sort === 'popular' ? 'popular' : 'recent'); all = r.posts.map(p => p.id); users = r.users.map(u => u.name); }
        else if (scope === 'notifs') all = api.notifications(by).map(n => n.id);
        else if (scope === 'convs') all = api.conversations(by).map(c => c.last.id);
        else all = api.conversation(by, String(o.peer || '')).map(m => m.id).reverse();
        if (o.after) return { count: sortedById ? all.filter(i => i > +o.after).length : 0 };
        let rest = all;
        if (o.before) { const b = +o.before; if (sortedById) rest = all.filter(i => i < b); else { const k = all.indexOf(b); rest = k < 0 ? all : all.slice(k + 1); } }
        const out = { ids: rest.slice(0, limit), more: rest.length > limit, total: all.length };
        if (!o.before && scope === 'search') out.users = users;
        return out;
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
      // ---- groupes privés (2 à 8 membres) : messages, indicateur de lecture « Vu », blocage et signalement respectés ----
      createRoom(by, name, members) {
        const me = user(by); guard(by, true);
        name = String(name || '').trim(); need(name && name.length <= 40, 'Nom du groupe : 1 à 40 caractères');
        const list = [...new Set((Array.isArray(members) ? members : []).map(n => user(n).name).filter(n => n !== me.name))];
        need(list.length >= 1 && list.length <= ROOM_MAX - 1, `Un groupe privé compte de 2 à ${ROOM_MAX} membres (vous inclus)`);
        for (const n of list) roomOk(me, user(n));
        const r = { id: id(), name, owner: me.name, members: [me.name, ...list], at: now(), msgs: [], read: {} };
        db.rooms.push(r); save(); return r.id;
      },
      room(by, rid) { const r = db.rooms.find(x => x.id === +rid); need(r && has(r.members, user(by).name), 'Groupe introuvable'); return r; },
      // messages visibles par `by` : ceux des comptes qu'il a bloqués ou masqués disparaissent
      roomMessages(by, rid) { const r = api.room(by, rid); return r.msgs.filter(m => !hiddenFor(by, m.from)); },
      sendRoom(by, rid, text, images) {
        text = (text || '').trim(); const media = cleanMedia(images); images = cleanImages(images);
        need((text || images.length || media.length) && text.length <= 500, 'Message invalide');
        const me = user(by), r = api.room(by, rid); guard(by, true);
        const m = { id: id(), from: me.name, text, at: now() }; if (images.length) m.images = images; if (media.length) m.media = media;
        r.msgs.push(m); if (r.msgs.length > 500) r.msgs = r.msgs.slice(-500);
        r.read[lc(me.name)] = m.id;
        for (const n of r.members) {
          const t = db.users[lc(n)]; if (!t || t.name === me.name || has(r.muted || [], t.name) || blockedBy(me.name, t.name) || hiddenFor(t.name, me.name)) continue;
          const open = db.notifs.find(x => x.type === 'dm' && x.to === t.name && x.room === r.id && !x.read);
          if (open) { open.count = (open.count || 1) + 1; open.at = m.at; open.from = me.name; } else db.notifs.push({ id: id(), to: t.name, from: me.name, type: 'dm', room: r.id, postId: null, at: m.at, read: false, count: 1 });
        }
        save();
      },
      markRoomRead(by, rid) {
        const me = user(by), r = api.room(by, rid), last = r.msgs.reduce((a, m) => Math.max(a, m.id), 0);
        if ((r.read[lc(me.name)] || 0) >= last) return false;
        r.read[lc(me.name)] = last; for (const n of db.notifs) if (n.type === 'dm' && n.to === me.name && n.room === r.id) n.read = true; save(); return true;
      },
      // discussions de groupe de `by`, la plus récente d'abord : { room, last, unread }
      rooms(by) {
        const me = user(by);
        return db.rooms.filter(r => has(r.members, me.name)).map(r => {
          const vis = r.msgs.filter(m => !hiddenFor(by, m.from)), seen = r.read[lc(me.name)] || 0;
          return { room: r, last: vis[vis.length - 1] || null, unread: vis.filter(m => m.from !== me.name && m.id > seen).length };
        }).sort((x, y) => ((y.last || { id: y.room.id }).id) - ((x.last || { id: x.room.id }).id));
      },
      // membres ayant lu le message `msgId` (hors auteur et comptes bloqués/masqués)
      roomSeenBy(by, rid, msgId) {
        const r = api.room(by, rid), m = r.msgs.find(x => x.id === msgId); if (!m) return [];
        return r.members.filter(n => n !== m.from && !hiddenFor(by, n) && (r.read[lc(n)] || 0) >= msgId);
      },
      // rôles : le créateur (owner) est toujours admin ; il peut nommer ou retirer d'autres admins
      isRoomAdmin: (by, rid) => radm(db.rooms.find(x => x.id === +rid), by),
      addToRoom(by, rid, who) {
        const me = user(by), r = api.room(by, rid), t = user(who); guard(by, true);
        need(radm(r, me.name), 'Réservé aux admins du groupe'); need(!has(r.members, t.name), 'Déjà membre');
        need(r.members.length < ROOM_MAX, `Un groupe est limité à ${ROOM_MAX} membres`); roomOk(me, t);
        r.members.push(t.name); save();
      },
      renameRoom(by, rid, name) {
        const me = user(by), r = api.room(by, rid); guard(by, true); need(radm(r, me.name), 'Réservé aux admins du groupe');
        name = String(name || '').trim(); need(name && name.length <= 40, 'Nom du groupe : 1 à 40 caractères'); r.name = name; save();
      },
      // retire un membre : un admin retire les membres simples, seul le créateur retire un admin
      removeFromRoom(by, rid, who) {
        const me = user(by), r = api.room(by, rid), t = user(who); guard(by, true);
        need(radm(r, me.name), 'Réservé aux admins du groupe'); need(has(r.members, t.name), 'Ce compte n’est pas membre');
        need(t.name !== me.name, 'Utilisez « Quitter » pour partir vous-même'); need(t.name !== r.owner, 'Le créateur ne peut pas être retiré');
        need(r.owner === me.name || !radm(r, t.name), 'Seul le créateur peut retirer un admin');
        r.members = r.members.filter(n => n !== t.name); r.admins = (r.admins || []).filter(n => n !== t.name); r.muted = (r.muted || []).filter(n => n !== t.name);
        delete r.read[lc(t.name)]; db.notifs = db.notifs.filter(n => !(n.room === r.id && n.to === t.name));
        if (r.members.length < 2) db.rooms = db.rooms.filter(x => x !== r); save();
      },
      setRoomAdmin(by, rid, who, on) {
        const me = user(by), r = api.room(by, rid), t = user(who); guard(by, true);
        need(r.owner === me.name, 'Réservé au créateur du groupe'); need(has(r.members, t.name), 'Ce compte n’est pas membre'); need(t.name !== r.owner, 'Le créateur est déjà admin');
        r.admins = (r.admins || []).filter(n => n !== t.name); if (on) r.admins.push(t.name); save();
      },
      // notifications propres à cette conversation : en sourdine, les messages restent « non lus » mais n'alertent plus
      setRoomMute(by, rid, on) {
        const me = user(by), r = api.room(by, rid); r.muted = (r.muted || []).filter(n => n !== me.name); if (on) r.muted.push(me.name);
        if (on) db.notifs = db.notifs.filter(n => !(n.type === 'dm' && n.room === r.id && n.to === me.name && !n.read)); save();
      },
      leaveRoom(by, rid) {
        const me = user(by), r = api.room(by, rid);
        r.members = r.members.filter(n => n !== me.name); delete r.read[lc(me.name)];
        r.admins = (r.admins || []).filter(n => n !== me.name); r.muted = (r.muted || []).filter(n => n !== me.name);
        if (r.owner === me.name) { r.owner = r.admins[0] || r.members[0]; r.admins = r.admins.filter(n => n !== r.owner); }
        if (r.members.length < 2) db.rooms = db.rooms.filter(x => x !== r);
        db.notifs = db.notifs.filter(n => !(n.room === r.id && n.to === me.name)); save();
      },
      // signaler un message privé : rid = id du groupe, ou null pour un message 1-à-1 (transmis à l'administrateur)
      reportMessage(by, rid, msgId, reason, note) {
        const me = user(by); need(REASONS[reason], 'Choisissez un motif de signalement');
        let m, members;
        if (rid) { const r = api.room(by, rid); m = r.msgs.find(x => x.id === +msgId); members = r.members.length; }
        else m = db.messages.find(x => x.id === +msgId && (x.to === me.name || x.from === me.name));
        need(m, 'Message introuvable'); need(m.from !== me.name, 'Vous ne pouvez pas signaler votre propre message');
        need(!user(m.from).admin, 'Le compte Streamer ne peut pas être signalé');
        note = (note || '').trim(); need(note.length <= 300, 'Précisions : 300 caractères max');
        need(!api.hasReportedMessage(by, rid, m.id), 'Vous avez déjà signalé ce message');
        db.msgReports.push({ id: id(), room: rid ? +rid : null, msgId: m.id, by: me.name, target: m.from, reason, note, at: now(), status: 'open', snap: { text: m.text, images: (m.images || []).length, members: members || 2 } });
        save();
      },
      hasReportedMessage: (by, rid, msgId) => db.msgReports.some(r => r.msgId === +msgId && (r.room || null) === (rid ? +rid : null) && lc(r.by) === lc(by) && r.status === 'open'),
      messageReports(by) { need(api.isAdmin(by), 'Réservé à l’administrateur'); return db.msgReports.filter(r => r.status === 'open').sort((a, b) => a.at - b.at); },
      resolveMessageReport(by, reportId, action, hours) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); need(['dismiss', 'warn', 'mute'].includes(action), 'Action inconnue');
        const r = db.msgReports.find(x => x.id === +reportId && x.status === 'open'); need(r, 'Signalement introuvable');
        const target = db.users[lc(r.target)]; hours = Math.min(24 * 90, Math.max(1, +hours || 24));
        if (target && action !== 'dismiss') {
          need(!target.admin, 'Impossible de sanctionner un administrateur');
          const prev = target.sanction || {};
          target.sanction = { type: action, at: now(), by: user(by).name, reason: REASONS[r.reason], warnings: (prev.warnings || 0) + (action === 'warn' ? 1 : 0) };
          if (action === 'mute') target.sanction.until = now() + hours * 36e5;
          (target.sanctions = target.sanctions || []).push({ id: id(), type: action, at: now(), by: user(by).name, reason: REASONS[r.reason], hours: action === 'mute' ? hours : 0, postId: null });
          notify(target.name, user(by).name, 'sanction', null, { what: action });
        }
        audit(by, 'msgreport-' + action, r.target, `message privé · ${REASONS[r.reason]}`);
        Object.assign(r, { status: action === 'dismiss' ? 'dismissed' : 'actioned', action, closedAt: now(), closedBy: user(by).name }); save();
      },
      // dernier de mes messages lu par `peer` (0 si rien) : base de l'indicateur « Vu » des échanges 1-à-1
      peerRead(by, peer) {
        if (db.peerRead) return db.peerRead[lc(peer)] || 0;
        const p = db.users[lc(peer)]; return p && !hiddenFor(by, p.name) && !blockedBy(by, p.name) ? ((p.dmRead || {})[lc(by)] || 0) : 0;
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
      // assistant de démarrage : étape en cours et achèvement (propres au compte, lus par l'accueil pour la checklist)
      setOnboarding(by, o) {
        const u = user(by); o = o || {}; const cur = u.onboarding || { step: 0, done: false };
        const step = o.step === undefined ? cur.step : Math.max(0, Math.min(5, Math.floor(+o.step) || 0));
        u.onboarding = { step, done: o.done === undefined ? !!cur.done : !!o.done };
        save(); return u.onboarding;
      },
      // checklist de profil : chaque étape est déduite des vraies données du compte, elle disparaît de l'accueil quand tout est fait
      checklist(by) {
        const u = user(by), n = u.name, inGroup = db.groups.some(g => roleIn(g, n) === 'owner' || roleIn(g, n) === 'mod' || roleIn(g, n) === 'member');
        const items = [['photo', 'Ajouter une photo de profil', !!u.photo], ['bio', 'Écrire une bio', !!(u.bio || '').trim()], ['topics', 'Suivre au moins 3 sujets', (u.topics || []).length >= 3],
          ['groups', 'Rejoindre une communauté', inGroup], ['follow', 'Suivre au moins 3 comptes', (u.following || []).length >= 3]].map(([key, label, done]) => ({ key, label, done }));
        return { items, done: items.filter(i => i.done).length, total: items.length, complete: items.every(i => i.done) };
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
        if (target && ['warn', 'mute', 'suspend', 'ban'].includes(action)) {
          const prev = target.sanction || {};
          target.sanction = { type: action, at: now(), by: user(by).name, reason: REASONS[open[0].reason], warnings: (prev.warnings || 0) + (action === 'warn' ? 1 : 0) };
          if (action === 'suspend' || action === 'mute') target.sanction.until = now() + hours * 36e5;
          (target.sanctions = target.sanctions || []).push({ id: id(), type: action, at: now(), by: user(by).name, reason: REASONS[open[0].reason], hours: action === 'suspend' || action === 'mute' ? hours : 0, postId });
          notify(target.name, user(by).name, 'sanction', null, { what: action });
        }
        audit(by, 'report-' + action, target ? target.name : open[0].target, `post #${postId} · ${REASONS[open[0].reason]} · ${open.length} signalement(s)` + (action === 'suspend' || action === 'mute' ? ` · ${hours} h` : ''));
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
      // ---- centre d'aide : demandes au support avec suivi (statut + échanges) ; un admin voit tout, un membre voit les siennes ----
      openTicket(by, category, subject, text) {
        const u = user(by); subject = String(subject || '').trim(); text = String(text || '').trim();
        need(['question', 'bug', 'account', 'idea', 'abuse'].includes(category), 'Catégorie inconnue');
        need(subject.length >= 3 && subject.length <= 80, 'Sujet : 3 à 80 caractères'); need(text.length >= 10 && text.length <= 1000, 'Décrivez votre demande : 10 à 1000 caractères');
        db.tickets = db.tickets || [];
        need(db.tickets.filter(x => x.user === u.name && x.status !== 'closed').length < 5, 'Déjà 5 demandes ouvertes : attendez une réponse ou clôturez-en une');
        const tk = { id: id(), user: u.name, category, subject, status: 'open', at: now(), upd: now(), msgs: [{ from: u.name, staff: false, text, at: now() }] };
        db.tickets.push(tk); save(); return tk;
      },
      tickets(by) { const u = user(by), l = db.tickets || []; return (u.admin ? l : l.filter(x => x.user === u.name)).slice().sort((a, b) => b.upd - a.upd); },
      replyTicket(by, ticketId, text) {
        const u = user(by), tk = (db.tickets || []).find(x => x.id === ticketId); text = String(text || '').trim();
        need(tk && (u.admin || tk.user === u.name), 'Demande introuvable'); need(tk.status !== 'closed', 'Demande clôturée : ouvrez-en une nouvelle');
        need(text.length >= 2 && text.length <= 1000, 'Message : 2 à 1000 caractères');
        const staff = !!u.admin && tk.user !== u.name;
        tk.msgs.push({ from: u.name, staff, text, at: now() }); tk.upd = now(); tk.status = staff ? 'answered' : 'open'; save(); return tk;
      },
      closeTicket(by, ticketId) {
        const u = user(by), tk = (db.tickets || []).find(x => x.id === ticketId);
        need(tk && (u.admin || tk.user === u.name), 'Demande introuvable'); tk.status = 'closed'; tk.upd = now(); save(); return tk;
      },
      hasAppealed: (by, kind, postId) => (db.appeals || []).some(a => lc(a.user) === lc(by) && a.kind === kind && a.postId === (postId || null) && a.status === 'open'),
      decideAppeal(by, appealId, accept, answer) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        const a = (db.appeals || []).find(x => x.id === appealId); need(a && a.status === 'open', 'Appel introuvable ou déjà traité');
        answer = String(answer || '').trim().slice(0, 300);
        if (accept) {
          const u = db.users[lc(a.user)], p = db.posts.find(x => x.id === a.postId);
          if (a.kind === 'sanction') { if (u) { const l = (u.sanctions || []).filter(x => x.type === (u.sanction || {}).type); if (l.length) l[l.length - 1].overturned = now(); delete u.sanction; } } else if (p) delete p.hidden;
        }
        Object.assign(a, { status: accept ? 'accepted' : 'rejected', answer, closedAt: now(), closedBy: user(by).name });
        audit(by, accept ? 'appeal-accept' : 'appeal-reject', a.user, (a.kind === 'hide' ? `post #${a.postId}` : 'sanction') + (answer ? ' · ' + answer : ''));
        notify(a.user, user(by).name, 'appeal', a.postId, { what: accept ? 'accepted' : 'rejected', answer });
        save();
      },
      // ---- profils vérifiés et badges de confiance : demande depuis le profil, revue par les admins, historique et révocation ----
      badgesOf(n) {
        const u = db.users[lc(n)]; if (!u) return [];
        const g = u.badges || {}, out = [];
        if (u.admin || g.verified) out.push('verified');
        if (u.admin || g.moderator) out.push('moderator');
        if (!u.admin && now() - u.joined >= VETERAN_MS) out.push('veteran');
        return out;
      },
      badgeInfo: () => BADGES,
      requestVerification(by, note) {
        const u = user(by); guard(by, true); note = String(note || '').trim();
        need(!u.admin, 'Le compte Streamer est déjà vérifié'); need(!(u.badges || {}).verified, 'Votre profil est déjà vérifié');
        need(note.length >= 10 && note.length <= 400, 'Expliquez votre demande : 10 à 400 caractères');
        db.verifs = db.verifs || [];
        need(!db.verifs.some(v => v.user === u.name && v.status === 'open'), 'Une demande est déjà en cours d’examen');
        const last = db.verifs.filter(v => v.user === u.name && v.status === 'rejected').pop();
        need(!last || now() - last.closedAt >= VERIF_COOLDOWN_MS, 'Une demande a été refusée il y a moins de 24 h : patientez avant de redemander');
        const v = { id: id(), user: u.name, note, at: now(), status: 'open' };
        db.verifs.push(v); blog(u.name, 'verified', 'request', u.name, note);
        for (const m of Object.values(db.users)) if (m.admin) notify(m.name, u.name, 'verif', null, { what: 'new' });
        save(); return v;
      },
      // admin : demandes ouvertes (les plus anciennes d'abord) ; membre : ses propres demandes
      verifRequests(by) {
        const u = user(by), l = db.verifs || [];
        return u.admin ? l.filter(v => v.status === 'open').sort((a, b) => a.at - b.at) : l.filter(v => v.user === u.name).sort((a, b) => b.at - a.at);
      },
      decideVerification(by, vid, accept, answer) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        const v = (db.verifs || []).find(x => x.id === vid); need(v && v.status === 'open', 'Demande introuvable ou déjà traitée');
        answer = String(answer || '').trim().slice(0, 300); const admin = user(by).name, u = db.users[lc(v.user)];
        need(accept || answer.length >= 3, 'Indiquez le motif du refus');
        Object.assign(v, { status: accept ? 'approved' : 'rejected', answer, closedAt: now(), closedBy: admin });
        if (accept && u) { u.badges = Object.assign({}, u.badges, { verified: { at: now(), by: admin } }); }
        blog(v.user, 'verified', accept ? 'grant' : 'reject', admin, answer || 'Demande acceptée');
        audit(by, accept ? 'verif-approve' : 'verif-reject', v.user, answer);
        notify(v.user, admin, 'verif', null, { what: accept ? 'accepted' : 'rejected', answer });
        save();
      },
      grantBadge(by, n, badge, reason) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); need(GRANTABLE.includes(badge), 'Badge inconnu');
        const u = user(n); need(!u.admin, 'Le compte Streamer possède déjà tous les badges'); need(!(u.badges || {})[badge], 'Ce badge est déjà attribué');
        reason = String(reason || '').trim().slice(0, 200) || 'Décision de l’administrateur'; const admin = user(by).name;
        u.badges = Object.assign({}, u.badges, { [badge]: { at: now(), by: admin } });
        for (const v of db.verifs || []) if (badge === 'verified' && v.user === u.name && v.status === 'open') Object.assign(v, { status: 'approved', answer: reason, closedAt: now(), closedBy: admin });
        blog(u.name, badge, 'grant', admin, reason); audit(by, 'badge-grant', u.name, `${BADGES[badge].label} · ${reason}`);
        notify(u.name, admin, 'verif', null, { what: 'granted', badge }); save();
      },
      revokeBadge(by, n, badge, reason) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); need(GRANTABLE.includes(badge), 'Badge inconnu');
        const u = user(n); need(!u.admin, 'Les badges du compte Streamer ne se révoquent pas'); need((u.badges || {})[badge], 'Ce badge n’est pas attribué');
        reason = String(reason || '').trim().slice(0, 200); need(reason.length >= 3, 'Indiquez le motif de la révocation'); const admin = user(by).name;
        const b = Object.assign({}, u.badges); delete b[badge]; u.badges = b;
        blog(u.name, badge, 'revoke', admin, reason); audit(by, 'badge-revoke', u.name, `${BADGES[badge].label} · ${reason}`);
        notify(u.name, admin, 'verif', null, { what: 'revoked', badge, answer: reason }); save();
      },
      // historique : celui d'un compte (le sien ou, pour un admin, n'importe lequel), ou le journal global (admin)
      badgeHistory(by, n) {
        const me = user(by);
        if (n === undefined || n === null) { need(me.admin, 'Réservé à l’administrateur'); return (db.badgeLog || []).slice().reverse(); }
        const u = user(n); need(me.admin || me.name === u.name, 'Réservé à l’administrateur');
        return (db.badgeLog || []).filter(e => lc(e.user) === lc(u.name)).reverse();
      },
      // historique d'un compte (admin) : sanctions successives, signalements reçus, appels
      accountHistory(by, n) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); const u = user(n);
        return { name: u.name, sanction: api.sanctionOf(u.name), sanctions: (u.sanctions || []).slice().reverse(),
          reports: db.reports.filter(r => lc(r.target) === lc(u.name)).sort((a, b) => b.at - a.at), appeals: (db.appeals || []).filter(a => lc(a.user) === lc(u.name)).sort((a, b) => b.at - a.at) };
      },
      adminUsers(by) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        return Object.values(db.users).map(u => ({ name: u.name, display: u.display || u.name, joined: u.joined, admin: !!u.admin, sanction: api.sanctionOf(u.name), warnings: (u.sanctions || []).length,
          posts: db.posts.filter(p => p.author === u.name).length, reports: db.reports.filter(r => r.target === u.name && r.status === 'open').length })).sort((a, b) => b.joined - a.joined);
      },
      // sanction directe d'un compte (sans passer par un signalement) : warn | suspend | ban
      adminSanction(by, n, type, hours, reason) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); need(['warn', 'mute', 'suspend', 'ban'].includes(type), 'Action inconnue');
        const u = user(n); need(!u.admin, 'Impossible de sanctionner un administrateur');
        reason = String(reason || '').trim().slice(0, 200) || 'Décision de l’administrateur'; hours = Math.min(24 * 90, Math.max(1, +hours || 24));
        const prev = u.sanction || {};
        u.sanction = { type, at: now(), by: user(by).name, reason, warnings: (prev.warnings || 0) + (type === 'warn' ? 1 : 0) };
        if (type === 'suspend' || type === 'mute') u.sanction.until = now() + hours * 36e5;
        (u.sanctions = u.sanctions || []).push({ id: id(), type, at: now(), by: user(by).name, reason, hours: type === 'suspend' || type === 'mute' ? hours : 0 });
        notify(u.name, user(by).name, 'sanction', null);
        audit(by, 'user-' + type, u.name, reason + (type === 'suspend' || type === 'mute' ? ` · ${hours} h` : '')); save();
      },
      adminDeleteUser(by, n, reason) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); const u = user(n); need(!u.admin, 'Le compte Streamer ne peut pas être supprimé');
        audit(by, 'user-delete', u.name, String(reason || '').trim().slice(0, 200) || 'Décision de l’administrateur'); purge(u); save();
      },
      adminStats(by) {
        need(api.isAdmin(by), 'Réservé à l’administrateur');
        const day = 86400000, t = now(), users = Object.values(db.users), t0 = db.totals || {};
        const act = users.filter(u => u.sanction && (!['suspend', 'mute'].includes(u.sanction.type) || u.sanction.until > t));
        const roots = db.posts.filter(p => !p.replyTo).length, replies = db.posts.length - roots;
        return { users: users.length, newUsers7: users.filter(u => t - u.joined < 7 * day).length, posts: roots + (t0.hiddenPosts || 0), replies, messages: db.messages.length + (t0.hiddenMessages || 0), groups: db.groups.length,
          likes: db.posts.reduce((s, p) => s + p.likes.length, 0), posts24: db.posts.filter(p => t - p.at < day).length, openReports: new Set(db.reports.filter(r => r.status === 'open').map(r => r.postId)).size,
          closedReports: db.reports.filter(r => r.status !== 'open').length, suspended: act.filter(u => u.sanction.type === 'suspend').length, muted: act.filter(u => u.sanction.type === 'mute').length, banned: act.filter(u => u.sanction.type === 'ban').length };
      },
      auditLog(by, limit) { need(api.isAdmin(by), 'Réservé à l’administrateur'); return (db.audit || []).slice(-(limit || 100)).reverse(); },
      // sanction active d'un compte (null si aucune ou expirée) ; l'admin peut la lever
      sanctionOf(n) { const s = (db.users[lc(n)] || {}).sanction; if (!s) return null; if ((s.type === 'suspend' || s.type === 'mute') && s.until <= now()) return null; return s; },
      liftSanction(by, n) {
        need(api.isAdmin(by), 'Réservé à l’administrateur'); const u = user(n); need(u.sanction, 'Aucune sanction active');
        audit(by, 'lift', u.name, u.sanction.type); delete u.sanction; save();
      },
      sanctioned: by => { need(api.isAdmin(by), 'Réservé à l’administrateur'); return Object.values(db.users).filter(u => u.sanction && (!['suspend', 'mute'].includes(u.sanction.type) || u.sanction.until > now())).map(u => ({ name: u.name, sanction: u.sanction })); },
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
        const bell = normPrefs(user(by).notifPrefs).types;
        const l = db.notifs.filter(n => n.to === user(by).name && !hiddenFor(by, n.from) && !(bell[n.type] && !bell[n.type].bell)).sort((a, b) => b.id - a.id);
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
      const { pass, epoch, blocked, muted, bookmarks, sanction, sanctions, dmRead, dmCleared, email, emailPending, lists, dismissed, topics, sharedLists, searches, notifPrefs, privacy, deleteAt, onboarding, fy, ...pub } = u;
      if (lists) pub.lists = k === lcm ? lists : lists.filter(l => l.public || (l.share && (me.sharedLists || []).some(r => r.owner.toLowerCase() === k && r.id === l.id && r.token === l.share))).map(l => ({ ...l, share: null }));
      if (k !== lcm && !privOk(db, me.name, u.name, 'profile')) Object.assign(pub, { bio: '', link: '', banner: '', display: '', photo: '', locked: true });
      if (k !== lcm && !privOk(db, me.name, u.name, 'posts')) pub.lockedPosts = true;
      if (k === lcm) Object.assign(pub, { privacy: normPrivacy(privacy), deleteAt, onboarding, fy, dismissed, topics, searches, notifPrefs, sharedLists, blocked, muted, bookmarks, sanction, sanctions, dmRead, dmCleared, email, emailPending });
      else if (me.admin) Object.assign(pub, { sanction, sanctions });
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
      users, posts: db.posts.filter(p => p.group ? readable.has(p.group) : privOk(db, me.name, p.author, 'posts')).map(p => p.hidden && !me.admin && p.author !== me.name ? Object.assign({}, p, { text: '', images: [], poll: undefined, history: [], quoteOf: undefined }) : p), groups, events: db.events.filter(e => !e.group || readable.has(e.group)), reposts: db.reposts.filter(r => { const p = db.posts.find(x => x.id === r.postId); return !p || p.group || privOk(db, me.name, p.author, 'posts'); }), seq: db.seq, drafts: db.drafts.filter(d => d.author === me.name), media: (db.media || []).filter(m => m.owner === me.name).map(({ src, ...m }) => m), attempts: {},
      messages: db.messages.filter(m => m.from === me.name || m.to === me.name),
      notifs: db.notifs.filter(n => n.to === me.name),
      rooms: db.rooms.filter(r => r.members.includes(me.name)).map(r => ({ ...r, msgs: r.msgs.slice(-200) })),
      msgReports: me.admin ? db.msgReports.filter(r => r.status === 'open') : db.msgReports.filter(r => r.by === me.name && r.status === 'open').map(r => ({ id: r.id, room: r.room, msgId: r.msgId, by: r.by, status: r.status })),
      peerRead: Object.fromEntries(Object.values(db.users).filter(u => u.name !== me.name && !(u.blocked || []).includes(me.name) && !(me.blocked || []).includes(u.name) && (u.dmRead || {})[lcm]).map(u => [u.name.toLowerCase(), u.dmRead[lcm]])),
      audit: me.admin ? (db.audit || []).slice(-300) : [], totals: me.admin ? { hiddenPosts: db.posts.filter(p => !p.replyTo && p.group && !readable.has(p.group)).length, hiddenMessages: db.messages.filter(m => m.from !== me.name && m.to !== me.name).length } : undefined,
      verifs: me.admin ? (db.verifs || []).slice(-200) : (db.verifs || []).filter(v => v.user === me.name),
      badgeLog: me.admin ? (db.badgeLog || []).slice(-500) : (db.badgeLog || []).filter(e => e.user === me.name),
      tickets: me.admin ? (db.tickets || []).slice(-300) : (db.tickets || []).filter(x => x.user === me.name),
      appeals: me.admin ? (db.appeals || []).slice(-200) : (db.appeals || []).filter(a => a.user === me.name),
      reports: me.admin ? db.reports : db.reports.filter(r => r.by === me.name).map(r => ({ id: r.id, postId: r.postId, by: r.by, status: r.status })),
    };
  }

  const exported = { Net, snapshot, ics, EV_REMINDS, GRACE_MS, PRIV_LEVELS, normPrefs, inQuiet, NP_TYPES, KEY, MAX_IMAGES, cleanImages, cleanMedia, MAX_VIDEO_S, MAX_AUDIO_S, REASONS, MEDIA_QUOTA, BADGES };
  if (typeof module !== 'undefined') module.exports = exported; else root.Social = exported;
})(this);
