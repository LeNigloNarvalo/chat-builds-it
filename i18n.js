// Internationalisation : dictionnaires fr / en / es, langue choisie dans les réglages (« auto » = langue du navigateur),
// dates et nombres localisés (Intl), et traduction d'un post (API Translator du navigateur si présente, sinon glossaire hors-ligne).
// La préférence est propre à chaque visiteur (clé « app.lang »).
(function (root) {
  const KEY = 'app.lang', LANGS = { fr: 'Français', en: 'English', es: 'Español' }, FALLBACK = 'fr';
  // ---- dictionnaires : {n} = paramètre, « clé.one / clé.other » = pluriel selon Intl.PluralRules ----
  const DICT = {
    fr: {
      'nav.feed': '🏠 Mon fil', 'nav.explore': '🌍 Explorer', 'nav.trends': '🔥 Tendances', 'nav.search': '🔎 Recherche', 'nav.bookmarks': '🔖 Favoris', 'nav.groups': '👥 Communautés', 'nav.lists': '🗂 Listes', 'nav.drafts': '📝 Brouillons',
      'nav.dm': '✉️ Messages', 'nav.profile': '👤 Profil', 'nav.theme': '🎨 Thème', 'nav.settings': '⚙️ Réglages', 'nav.blocks': '🚫 Bloqués', 'nav.security': '🔒 Sécurité', 'nav.stats': '📈 Statistiques', 'nav.dev': '🔑 API & Webhooks', 'nav.diag': '✅ Vérification', 'nav.mod': '🛡 Modération',
      'nav.label': 'Navigation principale', 'skip': 'Aller au contenu', 'title': 'Cornichon — le bocal à posts', 'phi': 'Mise en page au nombre d\'or : φ = {n}', 'offline.banner': '📴 Hors-ligne : fil en cache', 'offline.short': '⚠ hors ligne',
      'me.logout': 'Quitter', 'me.admin': ' 👑 admin', 'loading.server': 'Connexion au serveur…', 'loading.feed': 'Chargement du fil…', 'loading.more': 'Chargement de la suite…', 'seen.all': 'Vous avez tout vu 🥒', 'empty': 'Rien ici pour l’instant.',
      'auth.welcome': 'Bienvenue dans le bocal Cornichon', 'auth.user': 'Pseudo', 'auth.password': 'Mot de passe', 'auth.bio': 'Bio (inscription)', 'auth.login': 'Connexion', 'auth.signup': 'Créer un compte', 'auth.forgot': 'Mot de passe oublié ?',
      'mfa.title': '🔐 Double authentification', 'mfa.ok': 'Valider', 'mfa.cancel': 'Annuler', 'mfa.trust': 'Faire confiance à cet appareil pendant 30 jours',
      'composer.ph': 'Quoi de neuf ?', 'composer.reply': 'Votre réponse…', 'composer.send': 'Publier',
      'post.reply': 'Répondre', 'post.edited': 'modifié · v{n}', 'post.save': '💾 Enregistrer', 'post.cancel': 'Annuler', 'post.edit': 'Modifier le post', 'post.report': 'Signaler le post', 'post.reported': 'Post déjà signalé',
      'post.bookmark': 'Mettre en favori', 'post.unbookmark': 'Retirer des favoris', 'post.repost': 'Repartager sur mon profil', 'post.unrepost': 'Annuler le repartage',
      'post.translate': '🌐 Traduire ce post', 'post.translating': 'Traduction…', 'post.original': '↩ Voir l’original', 'post.translated': 'Traduit de {from} vers {to}', 'post.approx': 'traduction approximative (glossaire hors-ligne)', 'post.cantTranslate': 'Traduction impossible pour ce texte',
      'new.one': '⬆ {n} nouveau post', 'new.other': '⬆ {n} nouveaux posts', 'followers': 'abonnés', 'following': 'abonnements', 'follow': 'Suivre', 'unfollow': 'Se désabonner', 'message': 'Message',
      'ago.now': 'à l’instant', 'ago.min': '{n} min', 'ago.h': '{n} h', 'ago.d': '{n} j',
      'set.profile': '⚙️ Réglages du profil', 'set.display': 'Pseudo affiché', 'set.bio': 'Bio', 'set.avatar': 'Couleur d’avatar', 'set.banner': 'Image de bannière (URL)', 'set.link': 'Lien web', 'set.save': '💾 Enregistrer', 'set.security': '🔒 Sécurité', 'set.viewProfile': 'Voir mon profil',
      'set.look': '🎨 Apparence et accessibilité', 'set.theme': 'Thème', 'set.auto': '🖥 Auto', 'set.light': '☀️ Clair', 'set.dark': '🌙 Sombre', 'set.size': 'Taille du texte : {n} %', 'set.smaller': 'Réduire le texte', 'set.normal': 'Taille normale', 'set.bigger': 'Agrandir le texte',
      'set.keyboard': 'Navigation au clavier : Tab / Maj+Tab, Entrée ou Espace pour activer. Ces préférences restent sur cet appareil.',
      'lang.title': '🌍 Langue et formats', 'lang.label': 'Langue de l’interface', 'lang.auto': '🌐 Automatique (navigateur : {n})', 'lang.help': 'Les dates et les nombres suivent la langue choisie. Ce réglage reste sur cet appareil.',
      'lang.sample': 'Aperçu : {date} · {num}', 'lang.changed': 'Langue : {n}', 'lang.target': 'Traduire les posts vers', 'lang.targetSame': 'la langue de l’interface',
      'stats.points': '{n} points', 'rel.mod': 'Modération',
    },
    en: {
      'nav.feed': '🏠 My feed', 'nav.explore': '🌍 Explore', 'nav.trends': '🔥 Trending', 'nav.search': '🔎 Search', 'nav.bookmarks': '🔖 Bookmarks', 'nav.groups': '👥 Communities', 'nav.lists': '🗂 Lists', 'nav.drafts': '📝 Drafts',
      'nav.dm': '✉️ Messages', 'nav.profile': '👤 Profile', 'nav.theme': '🎨 Theme', 'nav.settings': '⚙️ Settings', 'nav.blocks': '🚫 Blocked', 'nav.security': '🔒 Security', 'nav.stats': '📈 Statistics', 'nav.dev': '🔑 API & Webhooks', 'nav.diag': '✅ Health check', 'nav.mod': '🛡 Moderation',
      'nav.label': 'Main navigation', 'skip': 'Skip to content', 'title': 'Cornichon — the jar of posts', 'phi': 'Golden-ratio layout: φ = {n}', 'offline.banner': '📴 Offline: cached feed', 'offline.short': '⚠ offline',
      'me.logout': 'Log out', 'me.admin': ' 👑 admin', 'loading.server': 'Connecting to the server…', 'loading.feed': 'Loading the feed…', 'loading.more': 'Loading more…', 'seen.all': 'You have seen everything 🥒', 'empty': 'Nothing here yet.',
      'auth.welcome': 'Welcome to the Cornichon jar', 'auth.user': 'Username', 'auth.password': 'Password', 'auth.bio': 'Bio (sign-up)', 'auth.login': 'Log in', 'auth.signup': 'Create an account', 'auth.forgot': 'Forgot your password?',
      'mfa.title': '🔐 Two-factor authentication', 'mfa.ok': 'Confirm', 'mfa.cancel': 'Cancel', 'mfa.trust': 'Trust this device for 30 days',
      'composer.ph': 'What’s new?', 'composer.reply': 'Your reply…', 'composer.send': 'Post',
      'post.reply': 'Reply', 'post.edited': 'edited · v{n}', 'post.save': '💾 Save', 'post.cancel': 'Cancel', 'post.edit': 'Edit post', 'post.report': 'Report post', 'post.reported': 'Post already reported',
      'post.bookmark': 'Bookmark', 'post.unbookmark': 'Remove bookmark', 'post.repost': 'Repost to my profile', 'post.unrepost': 'Undo repost',
      'post.translate': '🌐 Translate this post', 'post.translating': 'Translating…', 'post.original': '↩ Show original', 'post.translated': 'Translated from {from} to {to}', 'post.approx': 'approximate translation (offline glossary)', 'post.cantTranslate': 'This text cannot be translated',
      'new.one': '⬆ {n} new post', 'new.other': '⬆ {n} new posts', 'followers': 'followers', 'following': 'following', 'follow': 'Follow', 'unfollow': 'Unfollow', 'message': 'Message',
      'ago.now': 'just now', 'ago.min': '{n} min', 'ago.h': '{n} h', 'ago.d': '{n} d',
      'set.profile': '⚙️ Profile settings', 'set.display': 'Display name', 'set.bio': 'Bio', 'set.avatar': 'Avatar color', 'set.banner': 'Banner image (URL)', 'set.link': 'Web link', 'set.save': '💾 Save', 'set.security': '🔒 Security', 'set.viewProfile': 'View my profile',
      'set.look': '🎨 Appearance and accessibility', 'set.theme': 'Theme', 'set.auto': '🖥 Auto', 'set.light': '☀️ Light', 'set.dark': '🌙 Dark', 'set.size': 'Text size: {n}%', 'set.smaller': 'Smaller text', 'set.normal': 'Normal size', 'set.bigger': 'Larger text',
      'set.keyboard': 'Keyboard navigation: Tab / Shift+Tab, Enter or Space to activate. These preferences stay on this device.',
      'lang.title': '🌍 Language and formats', 'lang.label': 'Interface language', 'lang.auto': '🌐 Automatic (browser: {n})', 'lang.help': 'Dates and numbers follow the chosen language. This setting stays on this device.',
      'lang.sample': 'Preview: {date} · {num}', 'lang.changed': 'Language: {n}', 'lang.target': 'Translate posts into', 'lang.targetSame': 'the interface language',
      'stats.points': '{n} points', 'rel.mod': 'Moderation',
    },
    es: {
      'nav.feed': '🏠 Mi muro', 'nav.explore': '🌍 Explorar', 'nav.trends': '🔥 Tendencias', 'nav.search': '🔎 Buscar', 'nav.bookmarks': '🔖 Favoritos', 'nav.groups': '👥 Comunidades', 'nav.lists': '🗂 Listas', 'nav.drafts': '📝 Borradores',
      'nav.dm': '✉️ Mensajes', 'nav.profile': '👤 Perfil', 'nav.theme': '🎨 Tema', 'nav.settings': '⚙️ Ajustes', 'nav.blocks': '🚫 Bloqueados', 'nav.security': '🔒 Seguridad', 'nav.stats': '📈 Estadísticas', 'nav.dev': '🔑 API y Webhooks', 'nav.diag': '✅ Verificación', 'nav.mod': '🛡 Moderación',
      'nav.label': 'Navegación principal', 'skip': 'Ir al contenido', 'title': 'Cornichon — el tarro de posts', 'phi': 'Diseño áureo: φ = {n}', 'offline.banner': '📴 Sin conexión: muro en caché', 'offline.short': '⚠ sin conexión',
      'me.logout': 'Salir', 'me.admin': ' 👑 admin', 'loading.server': 'Conectando con el servidor…', 'loading.feed': 'Cargando el muro…', 'loading.more': 'Cargando más…', 'seen.all': 'Lo has visto todo 🥒', 'empty': 'Nada por aquí todavía.',
      'auth.welcome': 'Bienvenido al tarro Cornichon', 'auth.user': 'Usuario', 'auth.password': 'Contraseña', 'auth.bio': 'Bio (registro)', 'auth.login': 'Iniciar sesión', 'auth.signup': 'Crear una cuenta', 'auth.forgot': '¿Olvidaste tu contraseña?',
      'mfa.title': '🔐 Autenticación en dos pasos', 'mfa.ok': 'Validar', 'mfa.cancel': 'Cancelar', 'mfa.trust': 'Confiar en este dispositivo durante 30 días',
      'composer.ph': '¿Qué hay de nuevo?', 'composer.reply': 'Tu respuesta…', 'composer.send': 'Publicar',
      'post.reply': 'Responder', 'post.edited': 'editado · v{n}', 'post.save': '💾 Guardar', 'post.cancel': 'Cancelar', 'post.edit': 'Editar el post', 'post.report': 'Denunciar el post', 'post.reported': 'Post ya denunciado',
      'post.bookmark': 'Añadir a favoritos', 'post.unbookmark': 'Quitar de favoritos', 'post.repost': 'Compartir en mi perfil', 'post.unrepost': 'Anular el compartido',
      'post.translate': '🌐 Traducir este post', 'post.translating': 'Traduciendo…', 'post.original': '↩ Ver el original', 'post.translated': 'Traducido de {from} a {to}', 'post.approx': 'traducción aproximada (glosario sin conexión)', 'post.cantTranslate': 'No se puede traducir este texto',
      'new.one': '⬆ {n} post nuevo', 'new.other': '⬆ {n} posts nuevos', 'followers': 'seguidores', 'following': 'siguiendo', 'follow': 'Seguir', 'unfollow': 'Dejar de seguir', 'message': 'Mensaje',
      'ago.now': 'ahora mismo', 'ago.min': '{n} min', 'ago.h': '{n} h', 'ago.d': '{n} d',
      'set.profile': '⚙️ Ajustes del perfil', 'set.display': 'Nombre visible', 'set.bio': 'Bio', 'set.avatar': 'Color del avatar', 'set.banner': 'Imagen de banner (URL)', 'set.link': 'Enlace web', 'set.save': '💾 Guardar', 'set.security': '🔒 Seguridad', 'set.viewProfile': 'Ver mi perfil',
      'set.look': '🎨 Apariencia y accesibilidad', 'set.theme': 'Tema', 'set.auto': '🖥 Auto', 'set.light': '☀️ Claro', 'set.dark': '🌙 Oscuro', 'set.size': 'Tamaño del texto: {n} %', 'set.smaller': 'Reducir el texto', 'set.normal': 'Tamaño normal', 'set.bigger': 'Aumentar el texto',
      'set.keyboard': 'Navegación con teclado: Tab / Mayús+Tab, Intro o Espacio para activar. Estas preferencias se quedan en este dispositivo.',
      'lang.title': '🌍 Idioma y formatos', 'lang.label': 'Idioma de la interfaz', 'lang.auto': '🌐 Automático (navegador: {n})', 'lang.help': 'Las fechas y los números siguen el idioma elegido. Este ajuste se queda en este dispositivo.',
      'lang.sample': 'Vista previa: {date} · {num}', 'lang.changed': 'Idioma: {n}', 'lang.target': 'Traducir los posts a', 'lang.targetSame': 'el idioma de la interfaz',
      'stats.points': '{n} puntos', 'rel.mod': 'Moderación',
    },
  };
  const LOCALE = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' };

  // ---- langue : préférence enregistrée ('auto' ou code) -> langue effective ----
  const cleanPref = p => p === 'auto' || LANGS[p] ? p : 'auto';
  const load = st => { try { return cleanPref(JSON.parse(st.getItem(KEY))); } catch (e) { return 'auto'; } };
  const save = (st, p) => { p = cleanPref(p); st.setItem(KEY, JSON.stringify(p)); return p; };
  // première langue du navigateur que l'on sait afficher (« en-US » -> en), sinon français
  const detect = list => { for (const l of [].concat(list || [])) { const c = String(l || '').toLowerCase().split(/[-_]/)[0]; if (LANGS[c]) return c; } return FALLBACK; };
  const resolve = (pref, browser) => cleanPref(pref) === 'auto' ? detect(browser) : pref;

  // ---- état courant ----
  let lang = FALLBACK;
  const set = l => { lang = LANGS[l] ? l : FALLBACK; if (root.document) root.document.documentElement.lang = lang; return lang; };
  const get = () => lang;
  const fill = (s, p) => String(s).replace(/\{(\w+)\}/g, (m, k) => p && k in p ? p[k] : m);
  const tl = (l, key, p) => { const s = (DICT[l] && DICT[l][key] != null) ? DICT[l][key] : DICT[FALLBACK][key] != null ? DICT[FALLBACK][key] : key; return fill(s, p); };
  const t = (key, p) => tl(lang, key, p);
  // pluriel : « clé.one » / « clé.other » selon Intl.PluralRules de la langue ; {n} reçoit le nombre
  const tn = (key, n) => { const cat = new Intl.PluralRules(LOCALE[lang]).select(n), k = DICT[lang][key + '.' + cat] != null ? key + '.' + cat : key + '.other'; return fill(tl(lang, k), { n: num(n) }); };

  // ---- dates et nombres ----
  const loc = () => LOCALE[lang];
  const num = (n, o) => Number(n).toLocaleString(loc(), o);
  const date = (ms, o) => new Date(ms).toLocaleDateString(loc(), o || { dateStyle: 'medium' });
  const dateTime = (ms, o) => new Date(ms).toLocaleString(loc(), o);
  const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? t('ago.now') : m < 60 ? t('ago.min', { n: num(m) }) : m < 1440 ? t('ago.h', { n: num(Math.round(m / 60)) }) : t('ago.d', { n: num(Math.round(m / 1440)) }); };

  // ---- traduction d'un post ----
  const STOP = {
    fr: 'le la les un une des du de et est que qui pour pas dans sur avec je tu il nous vous ce cette mais ou où au aux en plus très bien salut merci'.split(' '),
    en: 'the a an and is are that who for not in on with i you he we this but or to of it very good hello thanks my your what'.split(' '),
    es: 'el la los las un una unos y es son que quien para no en con yo tú él nosotros esto pero o muy bien hola gracias mi tu qué'.split(' '),
  };
  const words = s => String(s).toLowerCase().match(/[\p{L}']+/gu) || [];
  // devine la langue d'un texte par ses mots courants ; null si aucun indice
  const guess = text => {
    const w = words(text); let best = null, top = 0;
    for (const l of Object.keys(STOP)) { const n = w.filter(x => STOP[l].includes(x)).length; if (n > top) { top = n; best = l; } }
    return best;
  };
  // glossaire hors-ligne (pivot : anglais). Mots entiers uniquement ; les #tags, @mentions et mots inconnus restent tels quels.
  const GLOSS = [
    // fr, en, es
    ['bonjour', 'hello', 'hola'], ['salut', 'hi', 'hola'], ['merci', 'thanks', 'gracias'], ['oui', 'yes', 'sí'], ['non', 'no', 'no'], ['bien', 'good', 'bien'], ['très', 'very', 'muy'], ['super', 'great', 'genial'],
    ['je', 'I', 'yo'], ['tu', 'you', 'tú'], ['nous', 'we', 'nosotros'], ['vous', 'you', 'ustedes'], ['et', 'and', 'y'], ['ou', 'or', 'o'], ['mais', 'but', 'pero'], ['pour', 'for', 'para'], ['avec', 'with', 'con'], ['sans', 'without', 'sin'],
    ['le', 'the', 'el'], ['la', 'the', 'la'], ['les', 'the', 'los'], ['un', 'a', 'un'], ['une', 'a', 'una'], ['dans', 'in', 'en'], ['sur', 'on', 'sobre'], ['est', 'is', 'es'], ['suis', 'am', 'soy'], ['sont', 'are', 'son'],
    ['ce', 'this', 'este'], ['cette', 'this', 'esta'], ['aujourd\'hui', 'today', 'hoy'], ['demain', 'tomorrow', 'mañana'], ['hier', 'yesterday', 'ayer'], ['maintenant', 'now', 'ahora'], ['ici', 'here', 'aquí'],
    ['jour', 'day', 'día'], ['nuit', 'night', 'noche'], ['soir', 'evening', 'tarde'], ['matin', 'morning', 'mañana'], ['ami', 'friend', 'amigo'], ['amis', 'friends', 'amigos'], ['jeu', 'game', 'juego'], ['jeux', 'games', 'juegos'],
    ['stream', 'stream', 'directo'], ['live', 'live', 'directo'], ['cornichon', 'pickle', 'pepinillo'], ['cornichons', 'pickles', 'pepinillos'], ['bocal', 'jar', 'tarro'], ['chat', 'cat', 'gato'], ['chien', 'dog', 'perro'], ['café', 'coffee', 'café'],
    ['aime', 'love', 'amo'], ['adore', 'love', 'adoro'], ['voir', 'see', 'ver'], ['regarde', 'watch', 'mira'], ['joue', 'play', 'juego'], ['quoi', 'what', 'qué'], ['neuf', 'new', 'nuevo'], ['nouveau', 'new', 'nuevo'], ['premier', 'first', 'primero'],
    ['belle', 'beautiful', 'bonita'], ['beau', 'beautiful', 'bonito'], ['grand', 'big', 'grande'], ['petit', 'small', 'pequeño'], ['content', 'happy', 'contento'], ['heureux', 'happy', 'feliz'], ['fête', 'party', 'fiesta'], ['musique', 'music', 'música'],
    ['pas', 'not', 'no'], ['plus', 'more', 'más'], ['tout', 'all', 'todo'], ['tous', 'everyone', 'todos'], ['monde', 'world', 'mundo'], ['bonne', 'good', 'buena'], ['bonsoir', 'good evening', 'buenas noches'], ['bonne nuit', 'good night', 'buenas noches'],
  ];
  const IDX = { fr: 0, en: 1, es: 2 };
  const glossaryTranslate = (text, from, to) => {
    const f = IDX[from], g = IDX[to], seen = new Map();
    for (const row of GLOSS) { const k = row[f].toLowerCase(); if (!seen.has(k)) seen.set(k, row); }
    // pivot : si la langue source n'est pas dans le glossaire (jamais le cas ici), on garde le mot
    return String(text).replace(/[\p{L}']+/gu, (w, off, all) => {
      if (/[#@]/.test(all[off - 1] || '')) return w;
      const row = seen.get(w.toLowerCase()); if (!row) return w;
      const out = row[g]; return w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out;
    });
  };
  // traduit un texte ; renvoie { text, from, to, approx }. L'API Translator du navigateur (locale, sans réseau applicatif) est préférée.
  async function translate(text, to, from) {
    from = from || guess(text); to = LANGS[to] ? to : lang;
    if (!from) from = to === 'fr' ? 'en' : 'fr';
    if (from === to) return { text, from, to, approx: false, same: true };
    const T = root.Translator;
    if (T && typeof T.create === 'function') {
      try {
        const tr = await T.create({ sourceLanguage: from, targetLanguage: to });
        return { text: await tr.translate(text), from, to, approx: false };
      } catch (e) { /* modèle indisponible : on retombe sur le glossaire */ }
    }
    const out = glossaryTranslate(text, from, to);
    if (out === text) throw new Error(t('post.cantTranslate'));
    return { text: out, from, to, approx: true };
  }

  const exported = { KEY, LANGS, DICT, LOCALE, FALLBACK, load, save, detect, resolve, set, get, t, tn, tl, num, date, dateTime, ago, guess, translate, glossaryTranslate, loc };
  if (typeof module !== 'undefined') module.exports = exported; else root.I18n = exported;
})(this);
