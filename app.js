// Vraie application client/serveur : les données vivent dans la base SQLite du serveur (server.js), communes à tous les appareils et au stream ;
// seules la session (app.session) et les préférences d'affichage restent propres à chaque appareil. Vue stream (?stream=1) : session du vrai compte « Streamer ».
const STREAM = new URLSearchParams(location.search).get('stream') === '1';
const SESSION = 'app.session', A11Y_KEY = A11y.KEY;
const store = localStorage;
const sync = Sync(store, SESSION);
const net = sync.net;
let booting = sync.hasSession(); // première synchro avec le serveur en cours
const sysDark = matchMedia('(prefers-color-scheme: dark)');
let prefs = A11y.load(store);
const applyPrefs = () => A11y.apply(prefs, document, sysDark.matches);
sysDark.addEventListener && sysDark.addEventListener('change', applyPrefs);
applyPrefs();
let langPref = I18n.load(store);
const t = I18n.t;
const browserLangs = () => navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
const applyLang = () => {
  I18n.set(I18n.resolve(langPref, browserLangs()));
  document.title = t('title'); const q = (s, f) => { const e = document.querySelector(s); if (e) f(e); };
  q('.skip', e => { e.textContent = t('skip'); }); q('#nav', e => e.setAttribute('aria-label', t('nav.label')));
  q('.phi', e => { e.title = t('phi', { n: I18n.num(1.618, { minimumFractionDigits: 3 }) }); e.textContent = 'φ ' + I18n.num(1.618, { minimumFractionDigits: 3 }); });
  q('#offline', e => { e.textContent = t('offline.banner'); });
};
applyLang();
let th = Theme.load(store);
const applyTheme = () => Theme.apply(th, document);
applyTheme();
let notice = '';
// liens reçus par e-mail (?verify=… / ?reset=…) : lus puis retirés de l'URL pour ne pas rester dans l'historique
let LINK = (() => { const q = new URLSearchParams(location.search), k = q.get('reset') ? 'reset' : q.get('verify') ? 'verify' : null;
  if (!k) return null; const token = q.get(k); q.delete('reset'); q.delete('verify'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); return { kind: k, token }; })();
let authMode = 'login'; // 'login' | 'forgot'
let mfa = null; // connexion en attente du code de double authentification : { name, password } (gardé en mémoire seulement, jamais stocké)
let linkMsg = ''; // résultat du lien ouvert (confirmation / réinitialisation)
// l'utilisateur connecté est celui que le serveur reconnaît pour la session de cet appareil
// lien de liste partagée : /?list=pseudo:id:jeton (retiré de l'URL, ouvert une fois connecté)
let SHARED = (() => { const q = new URLSearchParams(location.search), v = q.get('list'); if (!v) return null; q.delete('list'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '')); const [owner, id, token] = v.split(':'); return owner && id && token ? { owner, id: +id, token } : null; })();
let me = null;
const checkSession = () => { me = sync.me(); };
let view = { page: 'feed' };
let trendRange = '24h'; // période de la page Tendances : '24h' | '7d'
const $ = s => document.querySelector(s);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rich = s => esc(s).replace(/#\w+/g, t => `<span class="tag" data-tag="${t}">${t}</span>`).replace(/@\w+/g, t => `<span class="mention" data-user="${t.slice(1)}">${t}</span>`);
const color = n => `hsl(${[...n].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360},60%,45%)`;
const prof = n => { try { return net.profile(n); } catch (e) { return {}; } };
const shown = n => prof(n).display || n;
const av = (n, big) => `<span class="av${big ? ' big' : ''}" style="background:${prof(n).avatar || color(n)}">${esc(shown(n)[0].toUpperCase())}</span>`;
const GRADS = ['linear-gradient(135deg,#9146ff,#ff4d8d)', 'linear-gradient(135deg,#00c6ff,#0072ff)', 'linear-gradient(135deg,#f7971e,#ffd200)', 'linear-gradient(135deg,#11998e,#38ef7d)', 'linear-gradient(135deg,#232526,#9146ff)', 'linear-gradient(135deg,#ff512f,#dd2476)'];
const bannerCss = b => !b ? GRADS[0] : b.startsWith('grad:') ? GRADS[+b.slice(5)] : `center/cover url("${encodeURI(b).replace(/"/g, '%22')}"), ${GRADS[4]}`;
const peopleList = names => names.map(n => `<div class="card person" data-user="${esc(n)}">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)} · ${esc(prof(n).bio || '')}</span></div>`).join('') || '<p class="mut">Personne pour l’instant.</p>';
const ago = I18n.ago;
const go = (page, arg) => { if (page === 'security' || page === 'privacy') { ses.loaded = false; ses.msg = ''; } if (page === 'settings') { tfa.loaded = false; tfa.setup = null; tfa.codes = null; } if (page === 'stats') st.loaded = false; if (page === 'dev') { dev.loaded = false; dev.fresh = null; dev.detail = null; } view = { page, arg }; pend.post = []; pend.dm = []; curDraft = null; fs.scope = null; render(); };
// ---- fil paginé côté serveur (/api/feed) : pages de 10 posts, défilement infini, bandeau « N nouveaux posts » ----
const PAGE = 10, fs = { scope: null, who: null, ids: [], more: false, top: 0, fresh: 0, loaded: false, busy: false, gen: 0 };
// clé du fil affiché : « feed », « explore » ou « list:<propriétaire>:<id> » (fil dédié d'une liste de comptes)
const groupReadable = id => { try { const g = net.group(id); return g.public || net.groupRole(me, id) !== null && net.groupRole(me, id) !== 'pending' && net.groupRole(me, id) !== 'invited'; } catch (e) { return false; } };
const feedScope = () => !me ? null : view.page === 'feed' || view.page === 'explore' ? view.page : view.page === 'list' && view.arg ? 'list:' + view.arg.owner + ':' + view.arg.id : view.page === 'group' && view.arg && groupReadable(view.arg) && (view.tab || 'feed') === 'feed' ? 'group:' + view.arg : null;
const feedQuery = sc => { const [k, o, i] = sc.split(':'); return k === 'list' ? `scope=list&owner=${encodeURIComponent(o)}&list=${i}` : k === 'group' ? `scope=group&group=${o}` : 'scope=' + k; };
async function feedLoad(reset) {
  const sc = feedScope(); if (!sc) return;
  if (reset || fs.scope !== sc || fs.who !== me) Object.assign(fs, { scope: sc, who: me, ids: [], more: false, top: 0, fresh: 0, loaded: false, busy: false, gen: fs.gen + 1 });
  if (fs.busy) return;
  const gen = fs.gen; fs.busy = true;
  try {
    const j = await sync.get(`/api/feed?${feedQuery(sc)}&limit=${PAGE}${fs.ids.length ? '&before=' + fs.ids[fs.ids.length - 1] : ''}`);
    if (gen !== fs.gen) return;
    fs.ids.push(...j.posts.map(p => p.id).filter(i => !fs.ids.includes(i))); fs.more = j.more; fs.top = fs.top || fs.ids[0] || 0; fs.loaded = true; fs.busy = false;
  } catch (e) { if (gen === fs.gen) { err = e.message; fs.loaded = true; } }
  if (gen === fs.gen) { fs.busy = false; refresh(); } else { fs.busy = false; feedLoad(); }
}
// un changement est arrivé : combien de posts plus récents que le haut du fil affiché ?
async function feedFresh() {
  const sc = feedScope(); if (!sc || sc !== fs.scope || !fs.loaded) return;
  try { const j = await sync.get(`/api/feed?${feedQuery(sc)}&after=${fs.top || 0}`); if (sc === fs.scope && j.count !== fs.fresh) { fs.fresh = j.count; refresh(); } } catch (e) {}
}
const more = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) feedLoad(); }, { rootMargin: '300px' });
// ---- messages privés : « écrit… » (éphémère, via le flux temps réel) ----
const typing = {}; // pseudo -> expiration
const typingNow = () => Object.keys(typing).filter(n => typing[n] > Date.now());
const typingHTML = () => typingNow().includes(view.arg) ? `<span id="typing" class="mut" role="status">✍️ ${esc(shown(view.arg))} est en train d’écrire…</span>` : '<span id="typing" role="status"></span>';
let lastTyped = 0;
const onLive = (ev, d) => {
  if (ev === 'update') { sync.poll().then(feedFresh); if (view.page === 'stats') statsLoad(); }
  else if (ev === 'dev') { if (view.page === 'dev') devLoad(); }
  else if (ev === 'typing') { typing[d.from] = Date.now() + 4000; if (view.page === 'dm') refresh(); setTimeout(() => { if (view.page === 'dm') refresh(); }, 4100); }
};
const ensureLive = () => { if (me) sync.live(onLive); };

let err = '';
const diag = { res: null, busy: false };
async function runDiag() {
  diag.busy = true; render();
  diag.res = await Diag.run({ store, get: sync.get, me: () => me, connected: sync.connected });
  diag.busy = false; render();
}
// images en cours de rédaction (par zone de saisie) : { post: [{src, alt}], dm: [...] }, propres à ce visiteur
const pend = { post: [], dm: [] };
let lb = null; // visionneuse plein écran : { images, i }
const MAX_IMG = Social.MAX_IMAGES, MAX_SIDE = 1280, MAX_CHARS = 380000;
// import + redimensionnement automatique (canvas) ; un GIF léger garde son animation
async function prepImage(file) {
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error(`« ${file.name} » : format non pris en charge`);
  const read = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ko(new Error('Lecture impossible')); r.readAsDataURL(f); });
  const orig = await read(file);
  if (file.type === 'image/gif' && orig.length <= MAX_CHARS) return { src: orig, alt: '' };
  const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(`« ${file.name} » : image illisible`)); i.src = orig; });
  let k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight)), q = 0.85, out;
  for (let t = 0; t < 8; t++) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length <= MAX_CHARS) return { src: out, alt: '' };
    q = Math.max(0.5, q - 0.1); k *= 0.8;
  }
  throw new Error(`« ${file.name} » : image trop lourde`);
}
const gallery = (images, kind, id) => !images || !images.length ? '' : `<div class="gal n${images.length}">${images.map((im, i) => `<button class="gi" data-gal="${kind}:${id}:${i}" aria-label="Agrandir l’image ${i + 1} sur ${images.length}${im.alt ? ' : ' + esc(im.alt) : ''}"><img src="${im.src}" alt="${esc(im.alt || 'Image jointe ' + (i + 1))}" loading="lazy"></button>`).join('')}</div>`;
const attachBox = key => `<div class="att"><label class="filebtn">📷 Ajouter des images<input type="file" id="img-${key}" data-pick="${key}" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></label> <span class="mut">${pend[key].length}/${MAX_IMG} · redimensionnées automatiquement</span>
  <div class="prev">${pend[key].map((im, i) => `<div class="pv"><img src="${im.src}" alt="Aperçu ${i + 1}"><input id="alt-${key}-${i}" data-alt="${key}:${i}" maxlength="200" placeholder="Texte alternatif (décris l’image)" aria-label="Texte alternatif de l’image ${i + 1}" value="${esc(im.alt)}"><button data-rmimg="${key}:${i}" aria-label="Retirer l’image ${i + 1}">✕</button></div>`).join('')}</div></div>`;
function lightbox() {
  const o = document.getElementById('lb'); if (o) o.remove();
  if (!lb) return;
  const im = lb.images[lb.i], many = lb.images.length > 1, d = document.createElement('div');
  d.id = 'lb'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', 'Galerie d’images');
  d.innerHTML = `<button data-lbclose aria-label="Fermer">✕</button>${many ? '<button class="nv p" data-lbnav="-1" aria-label="Image précédente">‹</button><button class="nv n" data-lbnav="1" aria-label="Image suivante">›</button>' : ''}<figure><img src="${im.src}" alt="${esc(im.alt || 'Image ' + (lb.i + 1))}"><figcaption>${esc(im.alt || '')} <span class="mut">${lb.i + 1}/${lb.images.length}</span></figcaption></figure>`;
  document.body.appendChild(d); d.querySelector('[data-lbclose]').focus();
}
const closeLb = () => { const from = lb && lb.from; lb = null; lightbox(); if (from) { const b = document.querySelector(`[data-gal="${from}"]`); if (b) b.focus(); } };
const attempt = async f => { try { err = ''; await f(); } catch (e) { err = e.message; } render(); };
// re-rendu sans perdre la saisie en cours (changement venu d'un autre visiteur)
function refresh() {
  if (me) checkSession();
  const a = document.activeElement, keep = [...document.querySelectorAll('#app input[id],#app textarea[id]')].map(x => [x.id, x.value]);
  render();
  for (const [id, val] of keep) { const x = document.getElementById(id); if (x && !x.value) x.value = val; }
  if (a && a.id && document.getElementById(a.id)) document.getElementById(a.id).focus();
}
// ---- appli installable (PWA) + notifications : réglages propres à cet appareil (app.notifprefs) ----
let installEv = null, perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', ev => { if (ev.data && ev.data.openNotifs && me) go('notifs'); });
}
window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); installEv = ev; if (view.page === 'settings') refresh(); });
window.addEventListener('appinstalled', () => { installEv = null; notice = 'Cornichon est installé ✔'; if (view.page === 'settings') refresh(); });
const showOffline = () => { const o = document.getElementById('offline'); if (o) o.hidden = navigator.onLine; };
window.addEventListener('online', () => { showOffline(); sync.poll().then(feedFresh); }); window.addEventListener('offline', showOffline); showOffline();
const clearOffline = () => { if ('serviceWorker' in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('clear-data'); };
// à chaque changement de données : affiche les nouvelles mentions / réponses / abonnés selon les réglages
// nouveaux messages privés reçus (via le flux temps réel) : notification système si l'appli est en arrière-plan
let dmSeen = null;
const acct = () => ({ prefs: net.notifPrefs(me), inQuiet: Social.inQuiet });
function dmNotify() {
  const ids = net.db().messages.filter(m => m.to === me).map(m => m.id), top = ids.reduce((a, b) => Math.max(a, b), 0);
  if (dmSeen === null) { dmSeen = top; return; }
  const fresh = net.db().messages.filter(m => m.to === me && m.id > dmSeen && !net.isHidden(me, m.from)); dmSeen = Math.max(dmSeen, top);
  if (!fresh.length || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !Notif.load(store).enabled || !Notif.allowed(acct(), 'dm')) return;
  if (!document.hidden && view.page === 'dm' && fresh.every(m => m.from === view.arg)) return;
  const m = fresh[fresh.length - 1];
  try { new Notification('✉️ ' + shown(m.from), { body: (m.text || '📷 image').slice(0, 100), icon: 'icon.svg', tag: 'dm-' + m.from }); } catch (e) {}
}
function notifyNew() {
  if (!me || !Notif.supported()) return;
  const list = net.notifications(me), r = Notif.pick(list, Notif.load(store), Notif.seenGet(store, me), acct());
  Notif.seenSet(store, me, r.seen);
  dmNotify();
  if (Notification.permission !== 'granted') return;
  if (!document.hidden && view.page === 'notifs') return;
  for (const n of r.show.slice(-5)) Notif.show(n, shown(n.from));
}
// alertes des recherches enregistrées : le serveur crée la notification dès qu'un nouveau résultat apparaît
let alerting = false;
function searchAlerts() {
  if (!me || alerting || !net.searches(me).some(s => s.alert)) return;
  alerting = true; net.checkSearches(me).catch(() => {}).then(() => { alerting = false; });
}
sync.onChange(() => { refresh(); searchAlerts(); notifyNew(); });
window.addEventListener('storage', ev => { if (ev.key === SESSION) sync.pull(true).then(() => refresh(), () => refresh());  // connexion/déconnexion dans un autre onglet
  if (ev.key === Theme.KEY) { th = Theme.load(store); applyTheme(); if (view.page === 'theme' && me) refresh(); }
  if (ev.key === A11Y_KEY) { prefs = A11y.load(store); applyPrefs(); } if (ev.key === I18n.KEY) { langPref = I18n.load(store); applyLang(); refresh(); } if (ev.key === null) refresh(); });
const openSession = name => { me = name; if (SHARED && !booting) { const s = SHARED; SHARED = null; net.saveSharedList(me, s.owner, s.id, s.token).then(r => go('list', { owner: r.owner, id: r.id }), e => { err = e.message; render(); }); } };

// ---- double authentification (TOTP) : tout est stocké côté serveur, la page ne garde que la dernière lecture ----
const tfa = { data: null, loaded: false, setup: null, codes: null, msg: '', trusted: false };
async function tfaLoad() {
  try { tfa.data = await sync.get('/api/2fa'); } catch (e) { err = e.message; }
  tfa.loaded = true; if (view.page === 'settings') { const k = document.activeElement && document.activeElement.id; if (!/^tfa-/.test(k || '')) refresh(); }
}
// sessions actives et journal de sécurité (données du serveur, propres au compte)
const ses = { data: null, loaded: false, msg: '' };
const SEC_EVENTS = { login: '🔓 Connexion', login_fail: '⚠️ Échec de connexion', mfa_fail: '⚠️ Mauvais code de double authentification', signup: '🎉 Création du compte', logout: '🚪 Déconnexion', logout_all: '🚪 Déconnexion de tous les appareils', password_change: '🔑 Mot de passe changé', password_reset: '🔑 Mot de passe réinitialisé par e-mail', session_revoked: '🛑 Appareil révoqué', sessions_revoked: '🛑 Autres appareils révoqués' };
async function sesLoad() {
  try { ses.data = await sync.get('/api/sessions'); } catch (e) { err = e.message; }
  ses.loaded = true; if (view.page === 'security' || view.page === 'privacy') refresh();
}
function sessionsCard() {
  if (!ses.loaded) { sesLoad(); return '<div class="card"><h2>💻 Sessions actives</h2><p class="mut" role="status">Chargement…</p></div>'; }
  const d = ses.data || { sessions: [], log: [] };
  return `<div class="card" role="group" aria-labelledby="h-ses"><h2 id="h-ses">💻 Sessions actives (${d.sessions.length})</h2>
    <p class="mut">Les appareils connectés à votre compte : navigateur, date de connexion et dernière activité.</p>
    ${d.sessions.map(x => `<div class="card"><b>${esc(x.label)}</b>${x.current ? ' <span class="ok">· cet appareil</span>' : ''}<br><span class="mut">connecté ${dt(x.created)} · dernière activité ${dt(x.lastSeen)}</span>${x.current ? '' : ` <button data-ses="rm:${x.id}" aria-label="Révoquer la session ${esc(x.label)}">Révoquer</button>`}</div>`).join('') || '<p class="mut">Aucune session.</p>'}
    ${d.sessions.length > 1 ? '<button data-ses="rmall">🛑 Révoquer tous les autres appareils</button>' : ''}${ses.msg ? `<p class="ok" role="status">${esc(ses.msg)}</p>` : ''}</div>
    <div class="card" role="group" aria-labelledby="h-slog"><h2 id="h-slog">📜 Journal de sécurité</h2><p class="mut">Connexions, échecs et changements de mot de passe (100 derniers événements, sans adresse IP).</p>
    <ul class="slog" style="list-style:none;padding:0;margin:0;display:grid;gap:4px">${d.log.map(x => `<li>${SEC_EVENTS[x.kind] || esc(x.kind)} <span class="mut">· ${dt(x.at)}${x.label ? ' · ' + esc(x.label) : ''}</span></li>`).join('') || '<li class="mut">Aucun événement pour l’instant.</li>'}</ul></div>`;
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-ses]'); if (!b) return;
  const a = b.dataset.ses;
  if (a.startsWith('rm:')) attempt(async () => { await sync.send('/api/session-revoke', { id: a.slice(3) }); ses.msg = 'Appareil révoqué ✔'; await sesLoad(); });
  else if (a === 'rmall') { if (confirm('Déconnecter tous les autres appareils ?')) attempt(async () => { await sync.send('/api/sessions-revoke', {}); ses.msg = 'Autres appareils révoqués ✔'; await sesLoad(); }); }
});

// ---- confidentialité : visibilité du profil et des publications, export, connexions actives, suppression avec délai de grâce ----
const PRIV_OPTS = [['all', '🌍 Tout le monde'], ['followers', '👥 Mes abonnés'], ['me', '🔒 Moi seul·e']];
const DAY = 86400000;
function delBanner() {
  if (!me || !net.profile(me).deleteAt) return '';
  const at = net.profile(me).deleteAt, left = Math.max(0, Math.ceil((at - Date.now()) / DAY));
  return `<div class="card err" role="alert">🗑 Suppression de votre compte programmée le ${dt(at)} (dans ${left} jour${left > 1 ? 's' : ''}). <button data-privcancel>↩️ Annuler la suppression</button></div>`;
}
function privacyPage() {
  const pv = net.privacy(me), u = net.profile(me), group = (key, title, help) => `<div class="card" role="radiogroup" aria-labelledby="pv-${key}"><b id="pv-${key}">${title}</b><p class="mut">${help}</p>
    <div class="row">${PRIV_OPTS.map(([k, l]) => `<button role="radio" aria-checked="${pv[key] === k}" data-privset="${key}:${k}" class="${pv[key] === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  return `<div class="card"><h2>🛡️ Confidentialité</h2><p class="mut">Choisis qui voit ton profil et tes publications, récupère tes données, surveille tes connexions ou supprime ton compte. Les réglages sont appliqués par le serveur (fil, recherche, pages publiques et flux RSS compris) ; la modération garde son accès.</p></div>
    ${group('profile', '👤 Qui voit mon profil', 'Bio, lien et bannière. Les autres ne voient que ton pseudo et ton avatar si le profil est restreint, et ta page publique /u/… disparaît.')}
    ${group('posts', '📝 Qui voit mes publications', 'Posts, réponses et repartages : masqués du fil, de l’exploration, des recherches, des tendances, de ton profil, des pages publiques et des flux RSS pour ceux qui n’y ont pas droit.')}
    <div class="card" role="group" aria-labelledby="h-pdl"><h2 id="h-pdl">📦 Télécharger mes données</h2><p class="mut">Un fichier JSON avec ton profil, tes réglages de confidentialité, tes posts, messages, abonnements, favoris, listes, blocages, likes et la liste de tes connexions. Jamais ton mot de passe.</p>
    <button data-privdl>⬇️ Télécharger toutes mes données</button><p class="ok" role="status">${esc(notice)}</p></div>
    ${sessionsCard()}
    <div class="card" role="group" aria-labelledby="h-pdel"><h2 id="h-pdel">🗑 Supprimer mon compte</h2>
    ${u.deleteAt ? `<p class="err"><b>Suppression programmée le ${dt(u.deleteAt)}.</b> Jusqu’à cette date rien n’est effacé : annule quand tu veux, ou connecte-toi simplement pour garder ton compte.</p><button data-privcancel>↩️ Annuler la suppression</button>`
      : net.isAdmin(me) ? '<p class="mut">Le compte Streamer ne peut pas être supprimé.</p>'
      : `<p class="mut">Le compte, ses posts, réponses, likes, messages et abonnements seront effacés définitivement après un <b>délai de grâce de 7 jours</b>. Pendant ce délai tu peux annuler en un clic.</p>
        <input id="pv-pw" type="password" placeholder="Mot de passe pour confirmer" autocomplete="current-password" aria-label="Mot de passe pour confirmer la suppression"><button data-privdel>🗑 Programmer la suppression dans 7 jours</button>`}</div>`;
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-privset],[data-privdl],[data-privdel],[data-privcancel]'); if (!b || !me) return;
  if (b.dataset.privset) { const [key, val] = b.dataset.privset.split(':'); attempt(async () => { await net.setPrivacy(me, { [key]: val }); notice = 'Confidentialité mise à jour ✔'; }); }
  else if ('privdl' in b.dataset) attempt(async () => {
    const data = await net.exportUser(me); data.connections = await sync.get('/api/sessions');
    download(`cornichon-${me}-donnees.json`, JSON.stringify(data, null, 2)); notice = 'Données téléchargées ✔';
  });
  else if ('privdel' in b.dataset) attempt(async () => {
    if (!confirm('Programmer la suppression de votre compte dans 7 jours ?')) return;
    await net.requestDeletion(me, v1('#pv-pw')); notice = 'Suppression programmée ✔ : vous pouvez l’annuler jusqu’à l’échéance';
  });
  else if ('privcancel' in b.dataset) attempt(async () => { await net.cancelDeletion(me); notice = 'Suppression annulée ✔'; });
});
const v1 = s => ($(s) || {}).value;
const qrSvg = text => { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag(5, 3, 'QR code à scanner avec votre appli d’authentification', 'QR code TOTP'); };
const groupCode = c => String(c).replace(/(.{4})(?=.)/g, '$1 ');
function tfaCard() {
  if (!tfa.loaded) { tfaLoad(); return '<div class="card"><h2>🔐 Double authentification (TOTP)</h2><p class="mut" role="status">Chargement…</p></div>'; }
  const d = tfa.data || { enabled: false, devices: [], backupLeft: 0 }, e = err ? `<p class="err" role="alert">${esc(err)}</p>` : '';
  const codes = tfa.codes ? `<div class="card" role="status"><b class="ok">Codes de secours — notez-les maintenant, ils ne seront plus jamais affichés :</b>
    <div class="backup" id="tfa-codes">${tfa.codes.map(c => `<code>${esc(c)}</code>`).join('')}</div>
    <p class="mut">Chaque code ne sert qu’une fois, si vous perdez votre téléphone.</p><button data-tfa="copy">Copier</button> <button data-tfa="download">⬇️ Télécharger</button> <button data-tfa="ack">J’ai noté mes codes</button></div>` : '';
  let body;
  if (d.enabled) {
    body = `<p>✅ <b class="ok">Activée</b> — un code de votre appli est demandé à chaque connexion sur un nouvel appareil.</p>
      <p class="mut">Codes de secours restants : <b>${d.backupLeft}</b> sur 10${d.backupLeft <= 2 ? ' — pensez à en régénérer.' : '.'}</p>
      <label>Code actuel (appli ou secours) pour confirmer<input id="tfa-conf" inputmode="text" autocomplete="one-time-code" placeholder="123 456"></label>
      <label>Mot de passe<input id="tfa-pw" type="password" autocomplete="current-password" placeholder="Mot de passe"></label>
      <div class="row"><button data-tfa="regen">🔄 Régénérer les codes de secours</button> <button data-tfa="disable">🚫 Désactiver</button></div>
      <b>📱 Appareils de confiance (${d.devices.length})</b><p class="mut">Ces appareils passent l’étape du code pendant 30 jours.</p>
      ${d.devices.map(x => `<div class="card"><b>${esc(x.label)}</b> <span class="mut">ajouté ${dt(x.created)} · dernière connexion ${dt(x.last_used)} · expire ${dt(x.expires)}</span> <button data-tfa="rm:${x.id}" aria-label="Retirer l’appareil ${esc(x.label)}">Retirer</button></div>`).join('') || '<p class="mut">Aucun appareil de confiance.</p>'}
      ${d.devices.length > 1 ? '<button data-tfa="rmall">Retirer tous les appareils</button>' : ''}`;
  } else if (tfa.setup) {
    body = `<ol class="mut"><li>Installez une appli d’authentification (Aegis, 2FAS, Google Authenticator, Authy…).</li><li>Scannez ce QR code, ou saisissez le secret à la main.</li><li>Entrez le code à 6 chiffres affiché pour terminer.</li></ol>
      <div class="qr" id="tfa-qr">${qrSvg(tfa.setup.uri)}</div>
      <p>Secret : <code id="tfa-secret">${esc(groupCode(tfa.setup.secret))}</code> <span class="mut">(SHA-1 · 6 chiffres · 30 s)</span></p>
      <label>Code à 6 chiffres<input id="tfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456"></label>
      <label class="mut"><input type="checkbox" id="tfa-trust" style="width:auto" checked> Faire confiance à cet appareil</label><br>
      <button data-tfa="enable">✅ Activer</button> <button data-tfa="cancel">Annuler</button>`;
  } else body = `<p>❌ Désactivée. Ajoutez une couche de protection : en plus du mot de passe, un code temporaire de votre téléphone.</p><button data-tfa="start">🔐 Activer la double authentification</button>`;
  return `<div class="card" role="group" aria-labelledby="h-tfa"><h2 id="h-tfa">🔐 Double authentification (TOTP)</h2>${body}${tfa.msg ? `<p class="ok" role="status">${esc(tfa.msg)}</p>` : ''}${e}</div>${codes}`;
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-tfa]'); if (!b) return;
  const a = b.dataset.tfa, v = id => ($(id) || {}).value, clean = () => { tfa.msg = ''; };
  if (a === 'start') attempt(async () => { clean(); tfa.setup = await sync.send('/api/2fa/setup', {}); });
  else if (a === 'cancel') { tfa.setup = null; render(); }
  else if (a === 'enable') attempt(async () => {
    const trust = !!($('#tfa-trust') || {}).checked, r = await sync.send('/api/2fa/enable', { code: v('#tfa-code'), trust });
    if (r.trusted) sync.net.trustDevice(me, r.trusted);
    tfa.codes = r.codes; tfa.setup = null; tfa.msg = 'Double authentification activée ✔'; await tfaLoad();
  });
  else if (a === 'disable') { if (confirm('Désactiver la double authentification ? Les appareils de confiance seront oubliés.')) attempt(async () => { await sync.send('/api/2fa/disable', { code: v('#tfa-conf'), password: v('#tfa-pw') }); tfa.codes = null; await tfaLoad(); tfa.msg = 'Double authentification désactivée'; }); }
  else if (a === 'regen') attempt(async () => { tfa.codes = (await sync.send('/api/2fa/backup', { code: v('#tfa-conf'), password: v('#tfa-pw') })).codes; tfa.msg = 'Nouveaux codes générés ✔ (les anciens ne marchent plus)'; await tfaLoad(); });
  else if (a.startsWith('rm:')) attempt(async () => { await sync.send('/api/2fa/device-revoke', { id: +a.slice(3) }); tfa.msg = 'Appareil retiré ✔'; await tfaLoad(); });
  else if (a === 'rmall') attempt(async () => { await sync.send('/api/2fa/devices-revoke', {}); tfa.msg = 'Appareils retirés ✔'; await tfaLoad(); });
  else if (a === 'ack') { tfa.codes = null; render(); }
  else if (a === 'copy') { try { navigator.clipboard.writeText(tfa.codes.join('\n')); tfa.msg = 'Codes copiés ✔'; } catch (x) { tfa.msg = 'Sélectionnez les codes pour les copier'; } render(); }
  else if (a === 'download') download(`cornichon-${me}-codes-de-secours.txt`, `Codes de secours Cornichon (@${me}) — chacun ne sert qu'une fois\n\n${tfa.codes.join('\n')}\n`);
});
function langCard() {
  const eff = I18n.get(), now = Date.now();
  return `<div class="card" role="group" aria-labelledby="h-lang"><h2 id="h-lang">${t('lang.title')}</h2>
    <b id="l-lang">${t('lang.label')}</b><div class="row" role="group" aria-labelledby="l-lang"><button data-lang="auto" aria-pressed="${langPref === 'auto'}" class="${langPref === 'auto' ? 'on' : ''}">${t('lang.auto', { n: langName(I18n.detect(browserLangs())) })}</button>${Object.entries(I18n.LANGS).map(([k, l]) => `<button data-lang="${k}" lang="${k}" aria-pressed="${langPref === k}" class="${langPref === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="mut" role="status">${t('lang.sample', { date: I18n.dateTime(now, { dateStyle: 'full', timeStyle: 'short' }), num: I18n.num(1234567.89) })}</p><p class="mut">${t('lang.help')}</p></div>`;
}
// ---- centre de préférences de notifications : par type, cloche / push / e-mail, heures calmes, résumé quotidien (enregistrés sur le compte) ----
const NP_LABELS = { mention: '@ Mentions', dm: '✉️ Messages privés', reply: '💬 Réponses', follow: '👤 Nouveaux abonnés' }, NP_CH = [['bell', '🔔 Cloche'], ['push', '📲 Push'], ['email', '📧 E-mail']];
function prefsPage() {
  const p = net.notifPrefs(me), mail = net.profile(me).email, np = Notif.load(store), quiet = Social.inQuiet(p), hours = Array.from({ length: 24 }, (_, i) => i);
  return `<div class="card" role="group" aria-labelledby="h-np"><h2 id="h-np">🎛️ Préférences de notifications</h2>
    <p class="mut">Choisis, pour chaque type d’activité, où elle t’alerte. Les réglages sont enregistrés sur ton compte${quiet ? ' · <b>🌙 heures calmes en cours</b>' : ''}.</p>
    <table class="np" style="width:100%;border-collapse:collapse"><thead><tr><th scope="col" style="text-align:left">Type</th>${NP_CH.map(([, l]) => `<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>
    ${Social.NP_TYPES.map(k => `<tr><th scope="row" style="text-align:left">${NP_LABELS[k]}</th>${NP_CH.map(([c, l]) => `<td style="text-align:center"><input type="checkbox" data-np="${k}:${c}" aria-label="${NP_LABELS[k]} · ${l}" ${p.types[k][c] ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="mut">${np.enabled && perm === 'granted' ? '📲 Push actif sur cet appareil.' : '📲 Le push demande d’activer les notifications de cet appareil dans les <button data-page="settings">Réglages</button>.'} ${mail ? `📧 E-mails envoyés à ${esc(mail)}.` : '📧 Pas d’adresse vérifiée : ajoute-la dans <button data-page="security">Sécurité</button> pour recevoir des e-mails.'}</p></div>
  <div class="card" role="group" aria-labelledby="h-nq"><h2 id="h-nq">🌙 Heures calmes</h2>
    <label class="inl"><input type="checkbox" id="np-qon" data-npq ${p.quiet.on ? 'checked' : ''}> Ne pas m’alerter (push et e-mail) pendant cette plage</label>
    <div class="row"><label class="inl">De <input type="time" id="np-qfrom" data-npq value="${p.quiet.from}"></label> <label class="inl">à <input type="time" id="np-qto" data-npq value="${p.quiet.to}"></label></div>
    <p class="mut">La cloche continue de se remplir ; ce qui arrive la nuit reste dans le résumé ou part en une fois à la fin de la plage.</p></div>
  <div class="card" role="group" aria-labelledby="h-nd"><h2 id="h-nd">📰 Résumé quotidien par e-mail</h2>
    <label class="inl"><input type="checkbox" id="np-don" data-npq ${p.digest.on ? 'checked' : ''} ${mail ? '' : 'disabled'}> Recevoir chaque jour un résumé des activités manquées (non lues)</label>
    <label class="inl">vers <select id="np-dhour" data-npq>${hours.map(i => `<option value="${i}" ${p.digest.hour === i ? 'selected' : ''}>${String(i).padStart(2, '0')} h</option>`).join('')}</select></label>
    <p class="mut">${mail ? 'Un seul e-mail par jour, seulement s’il y a du nouveau.' : 'Nécessite une adresse e-mail vérifiée.'}</p></div>`;
}
async function savePrefs() {
  const p = { types: {}, quiet: { on: document.getElementById('np-qon').checked, from: document.getElementById('np-qfrom').value, to: document.getElementById('np-qto').value }, digest: { on: document.getElementById('np-don').checked, hour: +document.getElementById('np-dhour').value }, tz: new Date().getTimezoneOffset() };
  for (const k of Social.NP_TYPES) p.types[k] = {}; document.querySelectorAll('[data-np]').forEach(i => { const [k, c] = i.dataset.np.split(':'); p.types[k][c] = i.checked; });
  if (p.quiet.on && (!p.quiet.from || !p.quiet.to)) { err = 'Heures calmes : choisis une heure de début et de fin'; return render(); }
  await attempt(async () => { await net.setNotifPrefs(me, p); });
}
function notifCard() {
  const np = Notif.load(store), ok = Notif.supported(), on = np.enabled && perm === 'granted';
  return `<div class="card" role="group" aria-labelledby="h-app"><h2 id="h-app">📲 Application et notifications</h2>
    <p class="mut">${standalone() ? '✅ Cornichon est installé sur cet appareil.' : 'Installe Cornichon comme une vraie appli : icône, plein écran, fil disponible hors-ligne.'}</p>
    ${!standalone() && installEv ? '<button data-install>📲 Installer l’application</button>' : ''}
    <b>🔔 Notifications</b>
    ${!ok ? '<p class="mut">Ce navigateur ne gère pas les notifications.</p>' : perm === 'denied' ? '<p class="err">Notifications bloquées dans le navigateur : autorise-les dans les réglages du site.</p>'
      : `<p class="mut">${on ? 'Activées sur cet appareil.' : 'Désactivées sur cet appareil.'}</p><div class="row"><button data-notifmain aria-pressed="${on}">${on ? '🔕 Désactiver' : '🔔 Activer les notifications'}</button>${on ? ' <button data-notiftest>Tester</button>' : ''}</div>`}
    <div role="group" aria-label="Types de notifications">${Object.entries(Notif.TYPES).map(([k, l]) => `<label class="inl"><input type="checkbox" data-notiftype="${k}" ${np.types[k] ? 'checked' : ''}> ${l}</label>`).join('<br>')}</div>
    <p class="mut">Réglages enregistrés sur cet appareil. Les notifications s’affichent quand l’appli est ouverte ou installée, même en arrière-plan.</p></div>`;
}
const groupTag = id => { try { const g = net.group(id); return `<button class="lnk gtag" data-cmopen="${g.id}" aria-label="Communauté ${esc(g.name)}">👥 ${esc(g.name)}</button>`; } catch (e) { return ''; } };
// traduction d'un post (état par post, propre à ce visiteur) : { busy } | { text, from, to, approx } | { error }
const trans = {};
const langName = c => I18n.LANGS[c] || c;
const translateBar = (p, tx) => !tx ? `<button class="lnk" data-tr="${p.id}">${t('post.translate')}</button>`
  : tx.busy ? `<span class="mut" role="status">${t('post.translating')}</span>`
  : tx.error ? `<span class="err" role="alert">${esc(tx.error)}</span> <button class="lnk" data-trclose="${p.id}">✕</button>`
  : `<span class="mut" role="status">🌐 ${t('post.translated', { from: langName(tx.from), to: langName(tx.to) })}${tx.approx ? ' · ' + t('post.approx') : ''}${tx.same ? '' : ''}</span> <button class="lnk" data-trclose="${p.id}">${t('post.original')}</button>`;
async function translatePost(id) {
  const p = net.db().posts.find(x => x.id === id); if (!p) return;
  trans[id] = { busy: true }; refresh();
  try { const r = await I18n.translate(p.text, I18n.get()); trans[id] = r.same ? { error: t('post.cantTranslate') + ' (' + langName(r.from) + ')' } : r; }
  catch (e) { trans[id] = { error: e.message }; }
  refresh();
}
function quoteCard(p) {
  if (!p.quoteOf) return '';
  const q = net.db().posts.find(x => x.id === p.quoteOf);
  return q ? `<div class="qcard" data-open="${q.id}" role="group" aria-label="Post cité">${av(q.author)}<b>${esc(shown(q.author))}</b> <span class="mut">@${esc(q.author)} · ${ago(q.at)}</span>${q.text ? `<p>${rich(q.text)}</p>` : ''}</div>` : '<div class="qcard mut">Ce post cité a été supprimé.</div>';
}
const REACT_SET = ['❤️', '😂', '😮', '😢', '🔥', '🎉', '👏'];
function reactionsHTML(p) {
  const rs = net.reactions(p.id, me).filter(r => r.emoji !== '❤️'), mine = net.myReactions(me, p.id);
  const chips = rs.map(r => `<button class="chip ${mine.includes(r.emoji) ? 'on' : ''}" data-react="${p.id}|${r.emoji}" aria-pressed="${mine.includes(r.emoji)}" aria-label="${r.emoji} ${r.count}">${r.emoji} ${r.count}</button>`).join('');
  const picker = view.picker === p.id ? `<div class="picker" role="group" aria-label="Choisir une réaction">${REACT_SET.map(e => `<button data-react="${p.id}|${e}" class="${mine.includes(e) ? 'on' : ''}" aria-label="${e}">${e}</button>`).join('')}</div>` : '';
  const all = net.reactions(p.id, me), total = all.reduce((s, r) => s + r.count, 0);
  const who = view.rwho === p.id ? `<div class="rwho">${all.map(r => `<div><b>${r.emoji}</b> ${r.users.map(u => `<span class="mention" data-user="${esc(u)}">@${esc(u)}</span>`).join(' ')}</div>`).join('') || '<span class="mut">Aucune réaction.</span>'}</div>` : '';
  return `<div class="reacts">${chips}${total ? `<button class="lnk" data-rwho="${p.id}" aria-expanded="${view.rwho === p.id}">Qui a réagi ? (${total})</button>` : ''}</div>${who}${picker}`;
}
function postHTML(p, thread) {
  const liked = me && p.likes.includes(me), n = net.replies(p.id, me).length, editing = view.editing === p.id && net.canEdit(me, p.id);
  const saved = net.isBookmarked(me, p.id), rp = net.hasReposted(me, p.id), rc = net.repostCount(p.id), hist = p.history || [];
  const edited = p.editedAt ? `<button class="lnk" data-hist="${p.id}" aria-expanded="${view.hist === p.id}">${t('post.edited', { n: hist.length + 1 })}</button>` : '';
  const histHTML = p.editedAt && view.hist === p.id ? `<div class="hist"><b>Historique des modifications</b>${hist.map((h, i) => `<div class="mut">v${i + 1} · ${ago(h.at)} · ${esc(h.text)} ${net.canEdit(me, p.id) ? `<button class="lnk" data-restore="${p.id}:${i}">restaurer</button>` : ''}</div>`).join('')}<div>v${hist.length + 1} (actuelle) · ${esc(p.text)}</div></div>` : '';
  const body = editing ? `<textarea id="edit-txt" maxlength="280">${esc(view.restore && view.restore.id === p.id ? view.restore.text : p.text)}</textarea><button data-saveedit="${p.id}">${t('post.save')}</button> <button data-canceledit>${t('post.cancel')}</button> <span class="mut">${Math.ceil(net.editLeft(p.id) / 60000)} min restantes</span>` : `${p.text ? `<p>${tx && tx.text ? rich(tx.text) : rich(p.text)}</p>` : ''}${p.text ? translateBar(p, tx) : ''}${gallery(p.images, 'p', p.id)}`;
  const pollH = pollHTML(p), tx = trans[p.id];
  const hid = p.hidden, seeHidden = hid && (p.author === me || net.isAdmin(me));
  const modBanner = hid ? `<div class="err" role="status">🙈 Post masqué par la modération (${esc(hid.reason || '')}).${p.author === me ? (net.hasAppealed(me, 'hide', p.id) ? ' Appel en cours d’examen.' : ` <button data-appeal="hide:${p.id}">📨 Faire appel</button>`) : ''}</div>${view.appealing === 'hide:' + p.id ? appealForm('hide', p.id) : ''}` : '';
  return `<div class="card post" data-pid="${p.id}">${av(p.author)}<span class="who" data-user="${p.author}">${esc(shown(p.author))}</span> <span class="mut">@${esc(p.author)} · ${ago(p.at)}</span> ${edited}${p.group ? groupTag(p.group) : ''}
  ${modBanner}${hid && !seeHidden ? '<p class="mut">Ce contenu a été masqué par la modération.</p>' : body + quoteCard(p) + pollH}${histHTML}${view.reporting === p.id ? reportForm(p.id) : ''}<div class="acts"><button data-like="${p.id}" class="${liked ? 'on' : ''}">♥ ${p.likes.length}</button><button data-picker="${p.id}" aria-expanded="${view.picker === p.id}" aria-label="Réagir avec un émoji">😊</button>
  <button data-open="${p.id}">💬 ${n}</button>${!p.replyTo && p.author !== me ? `<button data-repost="${p.id}" class="${rp ? 'on' : ''}" aria-pressed="${rp}" aria-label="${rp ? t('post.unrepost') : t('post.repost')}">🔁 ${rc}</button>` : rc ? `<span class="mut">🔁 ${rc}</span>` : ''}
  ${!p.group && me ? `<button data-quote="${p.id}" class="${view.quoting === p.id ? 'on' : ''}" aria-label="Citer le post" title="Citer">❝ ${net.quoteCount(p.id)}</button>` : ''}${p.author !== me && !net.isAdmin(p.author) ? `<button data-report="${p.id}" class="${net.hasReported(me, p.id) ? 'on' : ''}" aria-label="${net.hasReported(me, p.id) ? t('post.reported') : t('post.report')}" ${net.hasReported(me, p.id) ? 'disabled' : ''}>🚩</button>` : ''}<a class="btn" href="/p/${p.id}" target="_blank" rel="noopener" aria-label="${t('share.page')}" title="${t('share.page')}">🔗</a><button data-bm="${p.id}" class="${saved ? 'on' : ''}" aria-pressed="${saved}" aria-label="${saved ? t('post.unbookmark') : t('post.bookmark')}">${saved ? '🔖' : '📑'}</button>${net.canEdit(me, p.id) && !editing ? `<button data-edit="${p.id}" aria-label="${t('post.edit')}">✏️</button>` : ''}${p.author === me || net.isAdmin(me) ? `<button data-del="${p.id}">🗑</button>` : ''}</div>${reactionsHTML(p)}${view.quoting === p.id ? `<div class="card quoteform"><label>Votre commentaire<textarea id="quote-txt" maxlength="280"></textarea></label>${quoteCard({ quoteOf: p.id })}<button data-sendquote="${p.id}">Citer</button> <button data-cancelquote>Annuler</button></div>` : ''}</div>`;
}
const reportForm = id => `<div class="card report" role="group" aria-label="Signaler ce post"><b>🚩 Signaler ce post</b>
  <label>Motif <select id="rp-reason">${Object.entries(net.reasons()).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
  <label>Précisions (facultatif)<textarea id="rp-note" maxlength="300"></textarea></label>
  <button data-sendreport="${id}">Envoyer le signalement</button> <button data-cancelreport>Annuler</button></div>`;
const SANC = { warn: '⚠️ Avertissement', suspend: '⏸ Suspension', ban: '⛔ Bannissement' };
const sancLabel = s => `${SANC[s.type]}${s.type === 'suspend' ? ` jusqu’à ${I18n.dateTime(s.until)}` : ''} · ${esc(s.reason || '')}`;
const APPEAL_ST = { open: '⏳ en attente', accepted: '✅ accepté', rejected: '❌ rejeté' };
function appealsQueue() {
  const l = net.appeals(me);
  return `<div class="card"><b>📨 Appels de membres</b> <span class="mut">· ${l.length} en attente</span></div>` + l.map(a => `<div class="card mod"><b>@${esc(a.user)}</b> <span class="mut">· ${a.kind === 'hide' ? 'post masqué #' + a.postId : 'mesure de modération'} · ${ago(a.at)}</span>
    <p class="mut">${esc(a.subject)}</p><blockquote>${esc(a.text)}</blockquote>
    <label>Réponse au membre (facultatif)<input id="ap-ans-${a.id}" maxlength="300"></label>
    <div class="row">${a.postId ? `<button data-open="${a.postId}">👁 Voir</button>` : ''}<button data-decide="${a.id}:1">✅ Accepter l’appel</button><button data-decide="${a.id}:0">❌ Rejeter</button></div></div>`).join('');
}
const appealForm = (kind, pid) => `<div class="card report" role="group" aria-label="Faire appel"><b>📨 Faire appel de cette décision</b>
  <label>Pourquoi cette décision est-elle injuste ?<textarea id="ap-text" maxlength="500"></textarea></label>
  <button data-sendappeal="${kind}:${pid || ''}">Envoyer l’appel</button> <button data-cancelappeal>Annuler</button></div>`;
const myAppeals = () => net.appeals(me).slice(0, 5).map(a => `<div class="mut">📨 ${a.kind === 'hide' ? 'Post #' + a.postId : 'Mesure'} · ${APPEAL_ST[a.status]}${a.answer ? ' · « ' + esc(a.answer) + ' »' : ''}</div>`).join('');
function modPage(e) {
  const q = net.queue(me), hist = net.history(me, 15), sl = net.sanctioned(me), R = net.reasons();
  return `<div class="card"><h2>🛡 File de modération</h2><p class="mut">${q.length} post${q.length > 1 ? 's' : ''} à examiner, les plus signalés d’abord.</p></div>${e}` +
  appealsQueue() +
  (q.map(g => `<div class="card mod"><b>@${esc(g.target)}</b> <span class="mut">· ${g.reports.length} signalement${g.reports.length > 1 ? 's' : ''}</span>
    <blockquote>${esc(g.snap.text) || '<span class="mut">(sans texte)</span>'}${g.snap.images ? ` <span class="mut">📷 ${g.snap.images}</span>` : ''}</blockquote>
    <ul>${g.reports.map(r => `<li><b>${esc(R[r.reason] || r.reason)}</b> · @${esc(r.by)} <span class="mut">${ago(r.at)}${r.note ? ' · ' + esc(r.note) : ''}</span></li>`).join('')}</ul>
    <label class="inl">Durée de suspension (h) <input id="mh-${g.postId}" type="number" min="1" max="2160" value="24"></label>
    <div class="row"><button data-open="${g.postId}">👁 Voir</button><button data-mod="${g.postId}:dismiss">✅ Classer sans suite</button><button data-mod="${g.postId}:hide">🙈 Masquer le post</button><button data-mod="${g.postId}:delete">🗑 Supprimer le post</button><button data-mod="${g.postId}:warn">⚠️ Avertir</button><button data-mod="${g.postId}:suspend">⏸ Suspendre</button><button data-mod="${g.postId}:ban">⛔ Bannir</button></div></div>`).join('') || '<p class="mut">Aucun signalement en attente 🎉</p>') +
  `<div class="card"><b>Comptes sanctionnés</b>${sl.map(x => `<div class="row"><span>@${esc(x.name)} · ${sancLabel(x.sanction)}</span><button data-lift="${esc(x.name)}">Lever</button></div>`).join('') || '<p class="mut">Aucun.</p>'}</div>
  <div class="card"><b>Historique</b>${hist.map(r => `<div class="mut">#${r.postId} @${esc(r.target)} · ${esc(R[r.reason] || r.reason)} → ${({ dismiss: 'sans suite', hide: 'post masqué', delete: 'post supprimé', warn: 'avertissement', suspend: 'suspension', ban: 'bannissement' })[r.action]} (${ago(r.closedAt)})</div>`).join('') || '<p class="mut">Vide.</p>'}</div>`;
}
// ---- tableau de bord d'administration : vue d'ensemble, utilisateurs, signalements, journal d'audit ----
const adm = { tab: 'overview', q: '', del: null, rest: null, bk: null, bkMsg: '' };
async function bkLoad() { try { adm.bk = await sync.get('/api/admin/backups'); } catch (e) { adm.bk = { backups: [], keep: 7, min: 1, max: 90 }; err = e.message; } if (view.page === 'admin') refresh(); }
const KINDS = { auto: '🕑 automatique', manual: '🖐 manuelle', pre: '🛟 avant restauration' };
const fsize = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko';
function backupsPage(head) {
  if (!adm.bk) { bkLoad(); return head + '<p class="mut" role="status">Chargement…</p>'; }
  const B = adm.bk, newest = B.backups[0];
  return head + `<div class="card"><b>💾 Sauvegardes du serveur</b>
    <p class="mut">Une copie complète de la base est faite automatiquement chaque jour. ${newest ? 'Dernière : ' + ago(newest.at) + '.' : 'Aucune sauvegarde pour l’instant.'} Restaurer remplace toutes les données actuelles (une sauvegarde de sécurité est créée juste avant).</p>
    <div class="row"><button data-bkcreate>➕ Sauvegarder maintenant</button>
    <label class="inl">Sauvegardes automatiques conservées <input id="bk-keep" type="number" min="${B.min}" max="${B.max}" value="${B.keep}" style="width:5em"></label><button data-bkkeep>Appliquer</button></div>
    ${adm.bkMsg ? `<p class="ok" role="status">${esc(adm.bkMsg)}</p>` : ''}</div>` +
    (B.backups.map(b => `<div class="card"><div><b>${esc(I.dateTime(b.at))}</b> <span class="mut">· ${ago(b.at)} · ${KINDS[b.kind]} · ${fsize(b.size)}</span></div>
      ${adm.rest === b.id ? `<div class="row" role="alert"><b>Remplacer toutes les données actuelles par cette version du ${esc(I.dateTime(b.at))} ?</b><button data-bkrestore="${esc(b.id)}">Oui, restaurer</button><button data-bkno>Annuler</button></div>`
      : `<div class="row"><button data-bkask="${esc(b.id)}">♻️ Restaurer</button><button data-bkdl="${esc(b.id)}">⬇️ Télécharger</button><button data-bkdel="${esc(b.id)}">🗑 Supprimer</button></div>`}</div>`).join('') || '<p class="mut">Aucune version disponible.</p>');
}
const AUDIT = { 'report-dismiss': '✅ signalement classé', 'report-delete': '🗑 post supprimé', 'report-hide': '🙈 post masqué', 'appeal-accept': '✅ appel accepté', 'appeal-reject': '❌ appel rejeté', 'report-warn': '⚠️ avertissement (signalement)', 'report-suspend': '⏸ suspension (signalement)', 'report-ban': '⛔ bannissement (signalement)', 'user-warn': '⚠️ avertissement', 'user-suspend': '⏸ suspension', 'user-ban': '⛔ bannissement', 'user-delete': '🗑 compte supprimé', lift: '🔓 sanction levée' };
function adminPage(e) {
  const S = net.adminStats(me), nq = net.queue(me).length + net.appeals(me).length;
  const tabs = [['overview', '📊 Vue d’ensemble'], ['users', `👥 Utilisateurs (${S.users})`], ['reports', `🚩 Signalements${nq ? ' (' + nq + ')' : ''}`], ['audit', '📜 Journal d’audit'], ['backups', '💾 Sauvegardes']];
  const head = `<div class="card"><h2>🛠 Tableau de bord d’administration</h2><p class="mut">Réservé aux administrateurs : toute action de modération est inscrite au journal d’audit.</p>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${adm.tab === k}" data-atab="${k}" class="${adm.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>${e}`;
  if (adm.tab === 'reports') return head + modPage('');
  if (adm.tab === 'backups') return backupsPage(head);
  if (adm.tab === 'audit') {
    const log = net.auditLog(me, 200);
    return head + `<div class="card"><b>Journal d’audit</b> <span class="mut">· ${log.length} dernière${log.length > 1 ? 's' : ''} action${log.length > 1 ? 's' : ''}</span>` + (log.length ? `<div class="scroll"><table class="dvlog"><thead><tr><th>Quand</th><th>Admin</th><th>Action</th><th>Cible</th><th>Détail</th></tr></thead><tbody>${log.map(a => `<tr><td title="${esc(I.dateTime(a.at))}">${ago(a.at)}</td><td>@${esc(a.by)}</td><td>${AUDIT[a.type] || esc(a.type)}</td><td>${a.target ? '@' + esc(a.target) : ''}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Aucune action de modération pour l’instant.</p>') + '</div>';
  }
  if (adm.tab === 'users') {
    const q = adm.q.trim().toLowerCase().replace(/^@/, ''), list = net.adminUsers(me).filter(u => !q || u.name.toLowerCase().includes(q) || u.display.toLowerCase().includes(q));
    return head + `<div class="card"><label>Rechercher un utilisateur <input id="adm-q" type="search" value="${esc(adm.q)}" placeholder="@pseudo" maxlength="40"></label>
      <label class="inl">Durée de suspension (h) <input id="adm-h" type="number" min="1" max="2160" value="24"></label> <label class="inl">Motif <input id="adm-r" maxlength="200" placeholder="Motif (inscrit au journal)"></label></div>` +
      (list.map(u => `<div class="card person"><div>${av(u.name)}<b>${esc(u.display)}</b> <span class="mut">@${esc(u.name)} · inscrit ${ago(u.joined)} · ${u.posts} post${u.posts > 1 ? 's' : ''}${u.reports ? ` · 🚩 ${u.reports}` : ''}${u.warnings ? ` · ${u.warnings} sanction${u.warnings > 1 ? 's' : ''} passée${u.warnings > 1 ? 's' : ''}` : ''}</span>${u.admin ? ' <span class="badge">👑 admin</span>' : ''}
        ${u.sanction ? `<div class="err">${sancLabel(u.sanction)}</div>` : ''}</div>
        ${u.admin ? '' : adm.del === u.name ? `<div class="row" role="alert"><b>Supprimer définitivement @${esc(u.name)} et tout son contenu ?</b><button data-adel="${esc(u.name)}">Oui, supprimer</button><button data-adelno>Annuler</button></div>`
        : `<div class="row"><button data-asanc="${esc(u.name)}:suspend">⏸ Suspendre</button><button data-asanc="${esc(u.name)}:warn">⚠️ Avertir</button><button data-asanc="${esc(u.name)}:ban">⛔ Bannir</button>${u.sanction ? `<button data-lift="${esc(u.name)}">🔓 Lever</button>` : ''}<button data-adelask="${esc(u.name)}">🗑 Supprimer</button></div>`}</div>`).join('') || '<p class="mut">Aucun utilisateur ne correspond.</p>');
  }
  const tile = (n, l) => `<div class="card tile"><b>${I18n.num(n || 0)}</b><span class="mut">${l}</span></div>`;
  return head + `<div class="tiles">${tile(S.users, 'utilisateurs')}${tile(S.newUsers7, 'nouveaux (7 j)')}${tile(S.posts, 'posts')}${tile(S.posts24, 'posts / 24 h')}${tile(S.replies, 'réponses')}${tile(S.likes, 'likes')}${tile(S.messages, 'messages privés')}${tile(S.groups, 'communautés')}${tile(S.openReports, 'signalements ouverts')}${tile(S.closedReports, 'signalements traités')}${tile(S.suspended, 'comptes suspendus')}${tile(S.banned, 'comptes bannis')}</div>`;
}
let curDraft = null, draftMsg = '';
const dtimers = {};
const localInput = ms => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const when = ms => I18n.dateTime(ms, { dateStyle: 'full', timeStyle: 'short' });
const pollDraft = { on: false, opts: ['', ''], minutes: 60 };
const DURS = [[5, '5 minutes'], [60, '1 heure'], [360, '6 heures'], [1440, '1 jour'], [4320, '3 jours'], [10080, '7 jours']];
const pollBox = () => !pollDraft.on ? `<button class="lnk" data-pollon>📊 Ajouter un sondage</button>` : `<fieldset class="pollbox"><legend>📊 Sondage</legend>
  ${pollDraft.opts.map((o, i) => `<input data-pollopt="${i}" maxlength="60" aria-label="Choix ${i + 1}" placeholder="Choix ${i + 1}" value="${esc(o)}">`).join('')}
  <div class="row">${pollDraft.opts.length < 4 ? '<button data-polladd>+ Ajouter un choix</button>' : ''}${pollDraft.opts.length > 2 ? '<button data-pollrm>− Retirer un choix</button>' : ''}
  <label class="inl">Durée <select id="poll-min">${DURS.map(([m, l]) => `<option value="${m}" ${m === pollDraft.minutes ? 'selected' : ''}>${l}</option>`).join('')}</select></label> <button data-polloff>Retirer le sondage</button></div></fieldset>`;
const pollRead = () => { document.querySelectorAll('[data-pollopt]').forEach(i => { pollDraft.opts[+i.dataset.pollopt] = i.value; }); const m = document.getElementById('poll-min'); if (m) pollDraft.minutes = +m.value; };
const rerender = () => { const t = document.getElementById('txt'), x = t ? t.value : ''; render(); const n = document.getElementById('txt'); if (n && x) n.value = x; };
const pollReset = () => { pollDraft.on = false; pollDraft.opts = ['', '']; pollDraft.minutes = 60; };
function pollHTML(p) {
  const pl = p.poll; if (!pl) return '';
  const total = pl.options.reduce((s, o) => s + o.votes.length, 0), mine = pl.options.findIndex(o => me && o.votes.includes(me));
  const open = !pl.closed && pl.endsAt > Date.now(), showRes = !open || mine >= 0 || !me;
  const left = Math.max(0, pl.endsAt - Date.now()), lt = left >= 86400000 ? Math.ceil(left / 86400000) + ' j' : left >= 3600000 ? Math.ceil(left / 3600000) + ' h' : Math.max(1, Math.ceil(left / 60000)) + ' min';
  const top = Math.max(...pl.options.map(o => o.votes.length));
  return `<div class="poll" role="group" aria-label="Sondage">${pl.options.map((o, i) => {
    const c = o.votes.length, pc = total ? Math.round(c * 100 / total) : 0;
    return showRes ? `<div class="pbar${!open && c === top && c ? ' win' : ''}${i === mine ? ' mine' : ''}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc}" aria-label="${esc(o.text)} : ${pc} %"><span class="fill" style="width:${pc}%"></span><span class="lbl">${i === mine ? '✔ ' : ''}${esc(o.text)}</span><b>${pc} % · ${c}</b></div>`
      : `<button class="popt" data-vote="${p.id}:${i}">${esc(o.text)}</button>`;
  }).join('')}<div class="mut">${total} vote${total > 1 ? 's' : ''} · ${open ? 'se termine dans ' + lt : 'sondage clos'}</div></div>`;
}
const composer = (ph, reply) => reply ? `<div class="card"><textarea id="txt" maxlength="280" placeholder="${ph}"></textarea>${attachBox('post')}<button data-send="${reply}">${t('composer.send')}</button></div>`
  : `<div class="card"><textarea id="txt" data-draft="new" maxlength="280" placeholder="${ph}"></textarea>${attachBox('post')}${pollBox()}<div class="row"><button data-send="">${t('composer.send')}</button>
  <label class="inl">ou le <input type="datetime-local" id="plan-at" aria-label="Date de publication planifiée" value="${localInput(Date.now() + 3600000)}"></label><button data-plan>📅 Planifier</button></div>
  <p class="mut" id="dr-note" role="status">Brouillon enregistré automatiquement · <button class="lnk" data-page="drafts">voir mes brouillons</button></p></div>`;
function draftsPage(e) {
  const ds = net.drafts(me), sch = ds.filter(d => d.scheduledAt), plain = ds.filter(d => !d.scheduledAt);
  const item = d => `<div class="card draft"><textarea id="dr-txt-${d.id}" data-draft="${d.id}" maxlength="280" aria-label="Texte du brouillon">${esc(d.text)}</textarea>
    ${d.images && d.images.length ? `<p class="mut">📷 ${d.images.length} image${d.images.length > 1 ? 's' : ''} jointe${d.images.length > 1 ? 's' : ''}</p>` : ''}
    ${d.scheduledAt ? `<p class="ok">📅 Publication prévue le ${esc(when(d.scheduledAt))} (heure du serveur)</p>` : ''}${d.failed ? `<p class="err">${esc(d.failed)}</p>` : ''}
    <div class="row"><label class="inl">Date <input type="datetime-local" id="dr-at-${d.id}" value="${localInput(d.scheduledAt || Date.now() + 3600000)}"></label>
    <button data-drplan="${d.id}">${d.scheduledAt ? '📅 Replanifier' : '📅 Planifier'}</button>${d.scheduledAt ? `<button data-drunplan="${d.id}">⏹ Déprogrammer</button>` : ''}
    <button data-drpub="${d.id}">🚀 Publier maintenant</button><button data-drdel="${d.id}">🗑 Supprimer</button></div>
    <span class="mut">enregistré ${ago(d.updatedAt)}</span></div>`;
  return `<div class="card"><h2>📝 Brouillons & publications planifiées</h2><p class="mut">Ce que tu écris est sauvegardé automatiquement. Une publication planifiée part à l’heure choisie, même si tu fermes le navigateur : c’est le serveur qui s’en charge.</p><p class="ok" role="status">${esc(draftMsg)}</p></div>${e}` + composer('Écris un nouveau brouillon…')
    + `<div class="card"><b>📅 Planifiés (${sch.length})</b></div>` + (sch.map(item).join('') || '<p class="mut">Aucune publication planifiée.</p>')
    + `<div class="card"><b>📝 Brouillons (${plain.length})</b></div>` + (plain.map(item).join('') || '<p class="mut">Aucun brouillon.</p>');
}
// enregistrement automatique 0,8 s après la dernière frappe (relit puis écrit côté serveur)
async function saveNow(k) {
  const t = document.querySelector(`[data-draft="${k}"]`), note = $('#dr-note'); if (!t || !me) return;
  const id = k === 'new' ? curDraft : +k, old = id ? net.drafts(me).find(x => x.id === id) : null;
  try {
    const d = await net.saveDraft(me, id, t.value, k === 'new' ? pend.post : (old ? old.images : []), {});
    if (k === 'new') curDraft = d ? d.id : null;
    if (note && k === 'new') note.innerHTML = d ? 'Brouillon enregistré ✔ <button class="lnk" data-page="drafts">voir mes brouillons</button>' : 'Brouillon automatique · <button class="lnk" data-page="drafts">voir mes brouillons</button>';
  } catch (e) { if (note) note.textContent = 'Brouillon non enregistré : ' + e.message; }
}
document.addEventListener('input', ev => {
  const k = ev.target.dataset && ev.target.dataset.draft; if (!k || !me) return;
  clearTimeout(dtimers[k]); dtimers[k] = setTimeout(() => saveNow(k), 800);
});

// encart « Qui suivre » (fil et explorer) : amis d'amis, sujets communs, suivi rapide ou « ignorer » ; relu depuis les données partagées à chaque rendu
function whoToFollow() {
  const l = net.suggestions(me, 4), why = x => x.reason === 'friends' ? `Suivi par ${x.via.map(n => '@' + esc(n)).join(', ')}${x.mutual > x.via.length ? ' et ' + (x.mutual - x.via.length) + ' autre(s)' : ''}`
    : x.reason === 'topics' ? 'Parle aussi de ' + x.tags.map(esc).join(', ') : 'Compte actif de la communauté';
  const intro = !net.profile(me).following.length ? '<p class="mut">Bienvenue ! Suis quelques comptes pour remplir ton fil 🥒</p>' : '';
  return `<section class="card who2f" aria-label="Qui suivre"><b>👥 Qui suivre</b>${intro}` + (l.length ? l.map(x => `<div class="sug">${av(x.name)}<span class="who" data-user="${esc(x.name)}"><b>${esc(shown(x.name))}</b> <span class="mut">@${esc(x.name)}</span></span>
    <span class="mut sugwhy">${why(x)}</span><span class="sugact"><button data-sfollow="${esc(x.name)}" aria-label="Suivre @${esc(x.name)}">＋ Suivre</button> <button data-sdismiss="${esc(x.name)}" aria-label="Ignorer la suggestion @${esc(x.name)}">Ignorer</button></span></div>`).join('')
    : '<p class="mut">Plus de suggestions pour le moment : reviens quand le bocal se sera rempli.</p>') + '</section>';
}
function render() {
  const nav = $('#nav'), app = $('#app');
  $('#me').innerHTML = me ? `${STREAM ? '<b>🔴 STREAM</b> ' : ''}@${esc(me)}${net.isAdmin(me) ? t('me.admin') : ''} <button data-logout>${t('me.logout')}</button>` : '';
  if (booting) { nav.innerHTML = ''; app.innerHTML = `<p class="mut" role="status">${t('loading.server')}</p>`; return; }
  if (me && !sync.online()) $('#me').innerHTML += ` <span class="err" role="status">${t('offline.short')}</span>`;
  if (LINK && LINK.kind === 'reset' && !linkMsg) {
    nav.innerHTML = '';
    app.innerHTML = `<div class="card"><h2>🔑 Nouveau mot de passe</h2><p class="mut">Ce lien ne fonctionne qu'une fois et expire au bout de 30 minutes. Vos sessions ouvertes seront fermées.</p>
      <input id="rs-pw" type="password" placeholder="Nouveau mot de passe (4 min)" autocomplete="new-password"><input id="rs-pw2" type="password" placeholder="Confirmer" autocomplete="new-password">
      <button data-doreset>Changer le mot de passe</button><p class="err" role="alert">${esc(err)}</p></div>`;
    return;
  }
  if (!me && linkMsg) {
    nav.innerHTML = ''; app.innerHTML = `<div class="card"><h2>Cornichon</h2><p role="status" class="${/✔/.test(linkMsg) ? 'ok' : 'err'}">${esc(linkMsg)}</p><button data-endlink>Aller à la connexion</button></div>`;
    return;
  }
  if (!me && authMode === 'forgot') {
    nav.innerHTML = '';
    app.innerHTML = `<div class="card"><h2>🔑 Mot de passe oublié</h2><p class="mut">Indiquez votre pseudo ou l'adresse e-mail vérifiée de votre compte : un lien à usage unique (30 min) y sera envoyé.</p>
      <input id="fg-id" placeholder="Pseudo ou e-mail" autocomplete="username"><button data-doforgot>Envoyer le lien</button> <button data-backlogin>Retour</button>
      <p class="err" role="alert">${esc(err)}</p><p class="ok" role="status">${esc(notice)}</p></div>`;
    return;
  }
  if (!me && mfa) {
    nav.innerHTML = '';
    app.innerHTML = `<div class="card"><h2>${t('mfa.title')}</h2><p class="mut">Compte @${esc(mfa.name)} : saisissez le code à 6 chiffres de votre appli d’authentification, ou un code de secours.</p>
      <input id="mfa-code" inputmode="text" autocomplete="one-time-code" placeholder="123 456 ou code de secours" aria-label="Code de double authentification" autofocus>
      <label class="mut"><input type="checkbox" id="mfa-trust" style="width:auto"> ${t('mfa.trust')}</label><br>
      <button data-mfago>${t('mfa.ok')}</button> <button data-mfaback>${t('mfa.cancel')}</button><p class="err" role="alert">${esc(err)}</p></div>`;
    const c = $('#mfa-code'); if (c) c.focus();
    return;
  }
  if (!me) {
    nav.innerHTML = '';
    app.innerHTML = `<div class="card"><h2>${t('auth.welcome')}</h2><input id="u" placeholder="${t('auth.user')}"><input id="pw" type="password" placeholder="${t('auth.password')}"><input id="bio" placeholder="${t('auth.bio')}">
    <button data-login>${t('auth.login')}</button> <button data-signup>${t('auth.signup')}</button> <button class="lnk" data-forgot>${t('auth.forgot')}</button><p class="err">${esc(err)}</p>${linkMsg ? `<p class="ok" role="status">${esc(linkMsg)}</p>` : ''}</div>`;
    return;
  }
  const unread = net.notifications(me).filter(n => !n.read).length, unreadDm = net.unreadDm(me);
  nav.innerHTML = [['feed', t('nav.feed')], ['explore', t('nav.explore')], ['trends', t('nav.trends')], ['search', `${t('nav.search')} ${net.searches(me).reduce((a, s) => a + s.fresh, 0) || ''}`], ['notifs', `🔔 ${unread || ''}`], ['bookmarks', t('nav.bookmarks')], ['groups', `${t('nav.groups')} ${net.groups().filter(g => net.groupRole(me, g.id) === 'invited').length || ''}`], ['lists', `${t('nav.lists')} ${(net.lists(me, me) || []).length || ''}`], ['drafts', `${t('nav.drafts')} ${net.drafts(me).length || ''}`], ['dm', `${t('nav.dm')} ${unreadDm.total || ''}`], ['profile', t('nav.profile')], ['theme', t('nav.theme')], ['prefs', t('nav.prefs')], ['settings', t('nav.settings')], ['blocks', t('nav.blocks')], ['security', t('nav.security')], ['privacy', t('nav.privacy')], ['stats', t('nav.stats')], ['dev', t('nav.dev')], ['diag', t('nav.diag')]].concat(net.isAdmin(me) ? [['admin', `${t('nav.mod')} ${(net.queue(me).length + net.appeals(me).length) || ''}`]] : [])
    .map(([k, l]) => `<button data-page="${k}" class="${view.page === k ? 'on' : ''}">${l}</button>`).join('');
  const e = err ? `<p class="err">${esc(err)}</p>` : '';
  // onglets du fil : global + une entrée par liste (les siennes)
  const tabs = () => { const ls = net.lists(me, me); return `<div class="card tabs" role="tablist" aria-label="Choix du fil"><button role="tab" aria-selected="${view.page === 'feed'}" class="${view.page === 'feed' ? 'on' : ''}" data-page="feed">🏠 Tout</button>${ls.map(l => `<button role="tab" aria-selected="${view.page === 'list' && view.arg.id === l.id}" class="${view.page === 'list' && view.arg.id === l.id && view.arg.owner === me ? 'on' : ''}" data-lopen="${esc(me)}:${l.id}">${l.public ? '🌐' : '🔒'} ${esc(l.name)}</button>`).join('')}<button data-page="lists">＋ Listes</button></div>`; };
  const mySanc = net.sanctionOf(me);
  const list = ps => ps.map(p => postHTML(p)).join('') || `<p class="mut">${t('empty')}</p>`;
  let h = '';
  const paged = () => {
    if (fs.scope !== feedScope() || fs.who !== me || !fs.loaded) return `<p class="mut" role="status">${t('loading.feed')}</p>`;
    const ps = fs.ids.map(i => net.db().posts.find(p => p.id === i)).filter(Boolean);
    return (fs.fresh ? `<button class="card newbar" data-newposts>${I18n.tn('new', fs.fresh)}</button>` : '') + list(ps)
      + (fs.more ? `<button class="card morebar" id="more" data-more>${t('loading.more')}</button>` : ps.length ? `<p class="mut" role="status">${t('seen.all')}</p>` : '');
  };
  if (view.page === 'feed') h = composer(t('composer.ph')) + whoToFollow() + tabs() + e + paged();
  else if (view.page === 'dev') h = devPage(e);
  else if (view.page === 'stats') h = statsPage(e);
  else if (view.page === 'groups') h = groupsPage(e);
  else if (view.page === 'group') h = groupPage(e, paged);
  else if (view.page === 'lists') h = listsPage(e);
  else if (view.page === 'list') h = listPage(e, paged);
  else if (view.page === 'explore') {
    h = composer(t('composer.ph')) + whoToFollow() + e + `<div class="card"><b>Tendances</b> ${net.trending().map(([t, c]) => `<span class="tag" data-tag="${t}">${t} (${c})</span>`).join(' ') || '<span class="mut">aucune</span>'}</div>` + paged();
  } else if (view.page === 'tag') {
    const tg = view.arg, sub = net.isTopic(me, tg), ps = net.tagFeed(tg, me), au = new Set(ps.map(p => p.author)).size;
    h = `<div class="card"><h2>${esc(tg)}</h2><p class="mut">${ps.length} post${ps.length > 1 ? 's' : ''} · ${au} auteur${au > 1 ? 's' : ''}</p>
      <div class="row"><button data-topic="${esc(tg)}" aria-pressed="${sub}">${sub ? '✔ Sujet suivi' : '＋ Suivre ce sujet'}</button> <button data-page="trends">🔥 Tendances</button></div></div>${e}` + list(ps);
  } else if (view.page === 'trends') {
    const medal = i => ['🥇', '🥈', '🥉'][i] || `#${i + 1}`, rg = trendRange, tt = net.trendingTopics(rg, me, 10), tp = net.trendingPosts(rg, me, 6), my = net.topics(me);
    const top = tt.length ? tt[0].score : 1, per = rg === '7d' ? '7 jours' : '24 h';
    h = `<div class="card"><h2>🔥 Tendances</h2><div class="tabs" role="tablist" aria-label="Période">${[['24h', '24 heures'], ['7d', '7 jours']].map(([k, l]) => `<button role="tab" aria-selected="${rg === k}" class="${rg === k ? 'on' : ''}" data-trange="${k}">${l}</button>`).join('')}</div></div>${e}
    <div class="card"><b>#️⃣ Sujets les plus actifs · ${per}</b><ol class="trend">${tt.map(x => `<li><span class="tag" data-tag="${esc(x.tag)}">${esc(x.tag)}</span> <span class="mut">${x.count} post${x.count > 1 ? 's' : ''} · ${x.authors} auteur${x.authors > 1 ? 's' : ''}</span> <button data-topic="${esc(x.tag)}" aria-pressed="${my.includes(x.tag)}">${my.includes(x.tag) ? '✔ Suivi' : '＋ Suivre'}</button><i class="bar" style="width:${Math.max(6, Math.round(x.score / top * 100))}%"></i></li>`).join('') || '<li class="mut">Aucun sujet sur cette période.</li>'}</ol></div>
    <div class="card"><b>⭐ Sujets que je suis</b> ${my.map(x => `<span class="tag" data-tag="${esc(x)}">${esc(x)}</span>`).join(' ') || '<span class="mut">Aucun : suis un sujet pour le retrouver ici.</span>'}</div>` +
      (my.length ? `<div class="card"><b>📰 Dans mes sujets</b></div>` + list(net.topicsFeed(me)) : '') +
      `<div class="card"><b>🏆 Posts les plus actifs · ${per}</b></div>` + (tp.map((r, i) => `<div class="rank"><span class="medal">${medal(i)}</span>${postHTML(r.post)}<span class="mut">${r.likes} ❤ · ${r.replies} 💬</span></div>`).join('') || '<p class="mut">Aucun post sur cette période.</p>');
  } else if (view.page === 'drafts') {
    h = draftsPage(e);
  } else if (view.page === 'bookmarks') {
    h = `<div class="card"><h2>🔖 Mes favoris</h2><p class="mut">Les posts que tu as mis de côté (visibles par toi seul).</p></div>${e}` + list(net.bookmarks(me));
  } else if (view.page === 'search') {
    const o = net.parseSearch(view.arg), r = net.find(o, me), ss = net.searches(me), day = ms => ms == null ? '' : new Date(ms).toLocaleDateString('sv-SE'), cur = ss.find(s => s.q === (view.arg || '').trim() && s.sort === o.sort);
    const bare = [o.text, o.from ? 'de:@' + o.from : '', o.since != null ? 'depuis:' + day(o.since) : '', o.until != null ? 'avant:' + day(o.until - 86400000) : '', o.image ? 'avec:image' : '', o.poll ? 'avec:sondage' : ''].filter(Boolean).join(' ');
    h = `<div class="card"><b>🔎 Recherche avancée</b>
      <div class="row"><input id="q" placeholder="Mot, #tag ou pseudo (opérateurs : de:@pseudo depuis:2025-01-31 avant: avec:image avec:sondage)" value="${esc(view.arg || '')}" aria-label="Recherche"><button data-dosearch>Chercher</button></div>
      <div class="row"><label class="inl">De <input id="sf-from" placeholder="@pseudo" maxlength="30" value="${esc(o.from ? '@' + o.from : '')}"></label>
      <label class="inl">Depuis <input id="sf-since" type="date" value="${day(o.since)}"></label>
      <label class="inl">Jusqu’au <input id="sf-until" type="date" value="${o.until != null ? day(o.until - 86400000) : ''}"></label>
      <label class="inl"><input id="sf-img" type="checkbox" ${o.image ? 'checked' : ''}> 🖼 avec image</label>
      <label class="inl"><input id="sf-poll" type="checkbox" ${o.poll ? 'checked' : ''}> 📊 avec sondage</label>
      <label class="inl">Tri <select id="sf-sort"><option value="recent" ${o.sort === 'recent' ? 'selected' : ''}>Plus récent</option><option value="popular" ${o.sort === 'popular' ? 'selected' : ''}>Plus populaire</option></select></label>
      <button data-sfapply>Appliquer les filtres</button></div>
      <div class="row">${bare ? (cur ? `<span class="mut">🔔 Recherche enregistrée : vous serez alerté des nouveaux résultats.</span> <button data-ssdel="${cur.id}">🗑 Retirer</button>` : `<input id="ss-name" placeholder="Nom (facultatif)" maxlength="40" aria-label="Nom de la recherche"><button data-sssave>💾 Enregistrer cette recherche</button>`) : ''}</div>
      <details class="ssmenu" ${ss.length ? 'open' : ''}><summary>📌 Mes recherches enregistrées ${ss.reduce((a, s) => a + s.fresh, 0) ? `<span class="badge">${ss.reduce((a, s) => a + s.fresh, 0)}</span>` : ''}</summary>
      ${ss.map(s => `<div class="row"><button data-ssopen="${s.id}">🔎 ${esc(s.name)}${s.name !== s.q ? ` <span class="mut">${esc(s.q)}</span>` : ''} · ${s.sort === 'popular' ? 'populaires' : 'récents'}</button>${s.fresh ? ` <span class="badge" title="Nouveaux résultats">${s.fresh} nouveau${s.fresh > 1 ? 'x' : ''}</span>` : ''} <button data-ssdel="${s.id}" aria-label="Supprimer ${esc(s.name)}">✕</button></div>`).join('') || '<p class="mut">Aucune recherche enregistrée.</p>'}</details></div>` +
      (bare ? `<p class="mut">${r.posts.length} post${r.posts.length > 1 ? 's' : ''}${r.users.length ? ` · ${r.users.length} compte${r.users.length > 1 ? 's' : ''}` : ''} · tri : ${o.sort === 'popular' ? 'populaire' : 'récent'}</p>` : '') +
      r.users.map(u => `<div class="card">${av(u.name)}<span class="who" data-user="${u.name}">${esc(shown(u.name))}</span> <span class="mut">${esc(u.bio)}</span></div>`).join('') + list(r.posts);
  } else if (view.page === 'notifs') {
    const L = { dm: 'vous a écrit', sanction: 'a pris une mesure de modération contre votre compte', like: 'a aimé votre post', reply: 'a répondu à votre post', mention: 'vous a mentionné', follow: 'vous suit', repost: 'a repartagé votre post', quote: 'a cité votre post', react: 'a réagi à votre post', group: Notif.TEXT.group, poll: 'Votre sondage est terminé : voir les résultats', search: 'a de nouveaux résultats' };
    const gname = id => { try { return net.group(id).name; } catch (x) { return 'une communauté supprimée'; } };
    h = net.notifications(me, true).map(n => `<div class="card" ${n.type === 'dm' ? `data-chat="${esc(n.from)}"` : n.type === 'search' ? `data-ssopen="${n.search}"` : n.type === 'group' ? `data-cmopen="${n.group}"` : n.postId ? `data-open="${n.postId}"` : `data-user="${n.from}"`}>${n.type === 'search' ? `🔎 <b>${esc(n.name)}</b> : ${n.count} nouveau${n.count > 1 ? 'x' : ''} résultat${n.count > 1 ? 's' : ''}` : ''}${n.type === 'search' ? '' : n.from ? `<b>${esc(n.from)}</b> ` : '📊 '}${n.type === 'react' && n.emoji ? n.emoji + ' ' : ''}${n.type === 'dm' && n.count > 1 ? `(×${n.count}) ` : ''}${n.type === 'group' ? `${L.group[n.what] || 'communauté'} · 👥 ${esc(gname(n.group))}` : n.type === 'search' ? '' : n.type === 'sanction' ? ({ warn: 'vous a averti', suspend: 'a suspendu votre compte', ban: 'a banni votre compte' })[n.what] || L.sanction : n.type === 'hide' ? 'a masqué votre post (vous pouvez faire appel)' : n.type === 'appeal' ? ({ new: 'a fait appel d’une décision', accepted: 'a accepté votre appel', rejected: 'a rejeté votre appel' })[n.what] + (n.answer ? ' : « ' + esc(n.answer) + ' »' : '') : L[n.type]} <span class="mut">· ${ago(n.at)}</span></div>`).join('') || '<p class="mut">Aucune notification.</p>';
  } else if (view.page === 'thread') {
    const p = net.db().posts.find(x => x.id === view.arg);
    h = p ? postHTML(p) + composer(t('composer.reply'), p.id) + e + net.replies(p.id, me).map(r => postHTML(r)).join('') : '<p class="mut">Post supprimé.</p>';
  } else if (view.page === 'profile') {
    const name = view.arg || me, u = net.profile(name), fl = net.followers(name), self = u.name === me;
    h = `<div class="card prof"><div class="banner" style="background:${bannerCss(u.banner)}"></div><div class="pbody">${av(u.name, true)}<b class="pname">${esc(u.display || u.name)}</b> <span class="mut">@${esc(u.name)}</span>
      <p>${u.locked ? '<span class="mut">🔒 Profil privé : ce compte n’a pas ouvert son profil à tout le monde.</span>' : esc(u.bio) || '<span class="mut">Pas de bio</span>'}</p>${u.link ? `<p><a href="${esc(u.link)}" target="_blank" rel="noopener noreferrer nofollow">🔗 ${esc(u.link.replace(/^https?:\/\//, ''))}</a></p>` : ''}
      <p class="stats"><button data-sub="followers:${u.name}" class="${view.sub === 'followers' ? 'on' : ''}"><b>${I18n.num(fl.length)}</b> ${t('followers')}</button> <button data-sub="following:${u.name}" class="${view.sub === 'following' ? 'on' : ''}"><b>${I18n.num(u.following.length)}</b> ${t('following')}</button></p>` +
      `<p class="feeds"><a href="/u/${encodeURIComponent(u.name)}" target="_blank" rel="noopener">🔗 ${t('share.page')}</a> · <a href="/u/${encodeURIComponent(u.name)}/feed.xml" target="_blank" rel="noopener">📡 ${t('share.rss')}</a> · <a href="/u/${encodeURIComponent(u.name)}/atom.xml" target="_blank" rel="noopener">${t('share.atom')}</a> · <a href="/public" target="_blank" rel="noopener">${t('share.index')}</a></p>` + (self ? `<button data-page="settings">⚙️ Modifier le profil</button>` : `<button data-follow="${u.name}">${fl.includes(me) ? t('unfollow') : t('follow')}</button> <button data-chat="${u.name}">${t('message')}</button>` + (u.admin ? '' : ` <button data-mute="${u.name}" aria-pressed="${net.isMuted(me, u.name)}">${net.isMuted(me, u.name) ? '🔊 Ne plus masquer' : '🔇 Masquer'}</button> <button data-block="${u.name}" aria-pressed="${net.isBlocked(me, u.name)}">${net.isBlocked(me, u.name) ? '✅ Débloquer' : '🚫 Bloquer'}</button>`)) + (net.sanctionOf(u.name) && net.isAdmin(me) ? ` <span class="err">${sancLabel(net.sanctionOf(u.name))}</span>` : '') + `</div></div>${e}` + profileLists(u.name, self) +
      (view.sub ? `<div class="card"><b>${view.sub === 'followers' ? 'Abonnés' : 'Abonnements'}</b> <button data-sub="">✕</button></div>` + peopleList(view.sub === 'followers' ? fl : u.following) : (net.timeline(name, me).map(t => (t.by ? `<p class="mut rt">🔁 ${esc(shown(t.by))} a repartagé</p>` : '') + postHTML(t.post)).join('') || (u.lockedPosts ? '<p class="mut">🔒 Les publications de ce compte sont privées.</p>' : '<p class="mut">Rien ici pour l’instant.</p>')));
  } else if ((view.page === 'admin' || view.page === 'mod') && net.isAdmin(me)) {
    h = adminPage(e);
  } else if (view.page === 'prefs') {
    h = prefsPage() + e;
  } else if (view.page === 'blocks') {
    const row = (n, kind) => `<div class="card person">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)}</span> <button data-${kind}="${esc(n)}">${kind === 'unblock' ? 'Débloquer' : 'Ne plus masquer'}</button></div>`;
    h = `<div class="card"><h2>🚫 Comptes bloqués et masqués</h2><p class="mut">Leurs posts, réponses et messages disparaissent de ton fil. Bloquer coupe aussi les abonnements et les empêche de te répondre, te suivre ou t’écrire ; masquer reste discret.</p></div>${e}
      <div class="card"><b>Bloqués</b></div>${net.blockedList(me).map(n => row(n, 'unblock')).join('') || '<p class="mut">Aucun compte bloqué.</p>'}
      <div class="card"><b>Masqués</b></div>${net.mutedList(me).map(n => row(n, 'unmute')).join('') || '<p class="mut">Aucun compte masqué.</p>'}`;
  } else if (view.page === 'theme') {
    h = themePage();
  } else if (view.page === 'settings') {
    const u = net.profile(me), b = u.banner || '';
    h = `<div class="card"><h2>${t('set.profile')}</h2><div class="banner" id="pvb" style="background:${bannerCss(b)}"></div>
      <label>${t('set.display')}<input id="s-display" maxlength="30" value="${esc(u.display || '')}" placeholder="${esc(u.name)}"></label>
      <label>${t('set.bio')}<textarea id="s-bio" maxlength="160">${esc(u.bio)}</textarea></label>
      <label>${t('set.avatar')}<input id="s-avatar" type="color" value="${u.avatar || '#9146ff'}"></label>
      <label>${t('set.banner')} <input id="s-banner" value="${esc(/^grad:/.test(b) ? '' : b)}" placeholder="https://…/image.jpg"></label>
      <div class="grads">${GRADS.map((g, i) => `<button data-grad="${i}" style="background:${g}" title="Dégradé ${i + 1}"></button>`).join('')}</div>
      <label>${t('set.link')}<input id="s-link" value="${esc(u.link || '')}" placeholder="https://twitch.tv/…"></label>
      <input id="s-gradv" type="hidden" value="${/^grad:/.test(b) ? b : ''}">
      <button data-saveprofile>${t('set.save')}</button> <button data-page="security">${t('set.security')}</button> <button data-user="${u.name}">${t('set.viewProfile')}</button>${e}</div>
      <div class="card" role="group" aria-labelledby="h-look"><h2 id="h-look">${t('set.look')}</h2>
      <b id="l-theme">${t('set.theme')}</b><div class="row" role="group" aria-labelledby="l-theme">${[['auto', t('set.auto')], ['light', t('set.light')], ['dark', t('set.dark')]].map(([k, l]) => `<button data-theme="${k}" aria-pressed="${prefs.theme === k}" class="${prefs.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <b id="l-size">${t('set.size', { n: I18n.num(prefs.size) })}</b><div class="row" role="group" aria-labelledby="l-size"><button data-size="-1" aria-label="${t('set.smaller')}" ${prefs.size === A11y.SIZES[0] ? 'disabled' : ''}>A−</button><button data-size="0" aria-label="${t('set.normal')}">A</button><button data-size="1" aria-label="${t('set.bigger')}" ${prefs.size === A11y.SIZES[A11y.SIZES.length - 1] ? 'disabled' : ''}>A+</button></div>
      <p class="mut">${t('set.keyboard')}</p></div>
      ${langCard()}
      ${notifCard()}
      ${tfaCard()}
      <div class="card" role="group" aria-labelledby="h-data"><h2 id="h-data">📦 Mes données</h2><p class="mut">Exporte ton profil, tes posts et tes messages en JSON (sans mot de passe), ou importe un export pour les fusionner dans ton compte.</p>
      <div class="row"><button data-export>⬇️ Exporter en JSON</button><label class="mut">Importer un fichier <input id="imp-file" type="file" accept="application/json,.json"></label></div>
      <label for="imp-txt">Ou colle le JSON ici</label><textarea id="imp-txt" class="json" placeholder='{"format":"cornichon-export",…}'></textarea><button data-import>⬆️ Importer</button>
      <p class="ok" role="status">${esc(notice)}</p></div>`;
  } else if (view.page === 'privacy') {
    h = privacyPage() + e;
  } else if (view.page === 'diag') {
    const r = diag.res;
    h = `<div class="card"><h2>✅ Vérification : tout est-il fonctionnel ?</h2><button data-diag ${diag.busy ? 'disabled' : ''}>${diag.busy ? 'Vérification en cours…' : '▶ Lancer la vérification'}</button>
      ${r ? `<p role="status"><b class="${r.every(x => x.ok) ? 'ok' : 'err'}">${esc(Diag.summary(r))}</b></p><ul class="diag">${r.map(x => `<li>${x.ok ? '✅' : '❌'} <b>${esc(x.name)}</b> <span class="mut">${esc(x.detail)}</span></li>`).join('')}</ul>` : '<p class="mut">Teste le serveur, la session, la synchro, le fil, le temps réel et le navigateur.</p>'}</div>`;
  } else if (view.page === 'security') {
    const mu = net.profile(me), em = mu.email ? `<p>✅ <b>${esc(mu.email)}</b> <span class="ok">vérifiée</span></p>` : '', pend = mu.emailPending ? `<p>⏳ <b>${esc(mu.emailPending)}</b> <span class="mut">en attente de confirmation : ouvrez le lien reçu.</span></p>` : '';
    h = `<div class="card"><h2>🔒 Sécurité</h2><b>✉️ Adresse e-mail</b>${em}${pend}${!mu.email && !mu.emailPending ? '<p class="mut">Aucune adresse : ajoutez-en une pour pouvoir récupérer votre compte.</p>' : ''}
      <input id="sec-mail" type="email" placeholder="${mu.email ? 'Changer d\'adresse' : 'votre@adresse.fr'}" autocomplete="email"><button data-setmail>${mu.emailPending ? 'Renvoyer le lien de confirmation' : 'Envoyer le lien de confirmation'}</button>${mu.email || mu.emailPending ? ' <button data-rmmail>Retirer</button>' : ''}
      <p class="mut">Seule une adresse vérifiée permet « Mot de passe oublié ». Jamais visible par les autres.</p></div>
      <div class="card"><b>Changer le mot de passe</b>
      <input id="sec-old" type="password" placeholder="Mot de passe actuel" autocomplete="current-password"><input id="sec-new" type="password" placeholder="Nouveau mot de passe (4 min)" autocomplete="new-password"><input id="sec-new2" type="password" placeholder="Confirmer le nouveau mot de passe" autocomplete="new-password">
      <button data-chpw>Changer le mot de passe</button> <p class="mut">Les autres appareils seront déconnectés. Après 5 connexions ratées, le pseudo est bloqué 60 s.</p></div>
      ${sessionsCard()}
      <div class="card"><b>Se déconnecter partout</b><p class="mut">Ferme toutes les sessions ouvertes, y compris celle-ci.</p><button data-logoutall>🚪 Déconnecter tous mes appareils</button></div>
      <div class="card"><b>Supprimer mon compte</b><p class="mut">La suppression se programme depuis la page Confidentialité, avec un délai de grâce de 7 jours pour changer d’avis.</p><button data-page="privacy">🛡️ Aller à la page Confidentialité</button></div>${e}${view.ok ? `<p class="ok">${esc(view.ok)}</p>` : ''}`;
  } else if (view.page === 'dm') {
    const convs = net.conversations(me), others = Object.values(net.db().users).filter(u => u.name !== me && !net.isHidden(me, u.name) && !convs.some(c => c.peer === u.name));
    const prev = m => (m.from === me ? 'Vous : ' : '') + (m.text ? m.text : '📷 image');
    h = `<div class="card"><h2>✉️ Mes conversations ${unreadDm.total ? `<b class="badge">${unreadDm.total}</b>` : ''}</h2><ul class="convs" style="list-style:none;padding:0;margin:0;display:grid;gap:6px">${convs.map(c => `<li><button data-chat="${esc(c.peer)}" class="${view.arg === c.peer ? 'on' : ''}" style="width:100%;text-align:left"><b>${esc(shown(c.peer))}</b>${c.unread ? ` <b class="badge" aria-label="${c.unread} non lu(s)">${c.unread}</b>` : ''}${typingNow().includes(c.peer) ? ' ✍️' : ''} <span class="mut">· ${ago(c.last.at)}</span><br><span class="${c.unread ? '' : 'mut'}">${esc(prev(c.last).slice(0, 80))}</span></button></li>`).join('') || '<li class="mut">Aucune conversation : choisis quelqu’un ci-dessous.</li>'}</ul></div>
      <div class="card"><b>Nouvelle discussion</b><br>${others.map(u => `<button data-chat="${esc(u.name)}" class="${view.arg === u.name ? 'on' : ''}">${esc(u.name)}</button>`).join(' ') || '<span class="mut">Personne d’autre pour l’instant.</span>'}</div>`;
    if (view.arg) h += `<div class="card" style="display:grid;gap:6px"><div class="row"><b>💬 ${esc(shown(view.arg))}</b> ${view.askDelDm ? `<span class="err">Supprimer cet échange de ton côté ?</span> <button data-dmdelyes>Oui, supprimer</button> <button data-dmdelno>Annuler</button>` : net.conversation(me, view.arg).length ? `<button data-dmdel>🗑 Supprimer l’échange</button>` : ''}</div>${net.conversation(me, view.arg).map(m => `<div class="msg ${m.from === me ? 'me' : ''}">${m.text ? esc(m.text) : ''}${gallery(m.images, 'm', m.id)}</div>`).join('') || '<span class="mut">Dites bonjour 👋</span>'}
      ${typingHTML()}<input id="dm" placeholder="Message à ${esc(view.arg)}">${attachBox('dm')}<button data-dm>Envoyer</button></div>${e}`;
  }
  if (view.page === 'dm' && view.arg && unreadDm.peers[view.arg] && document.hasFocus()) net.markDmRead(me, view.arg).catch(() => {}); // conversation ouverte : lue
  app.innerHTML = delBanner() + (mySanc ? `<div class="card err" role="alert">Mesure de modération : ${sancLabel(mySanc)} ${net.hasAppealed(me, 'sanction') ? '<span class="mut">· appel en cours d’examen</span>' : '<button data-appeal="sanction:">📨 Faire appel</button>'}</div>${view.appealing === 'sanction:' ? appealForm('sanction') : ''}` : '') + (!net.isAdmin(me) ? myAppeals() : '') + h;
  a11yPass();
  ensureLive();
  const m = $('#more'); if (m) more.observe(m);
  watchViews();
  if (feedScope() && (fs.scope !== feedScope() || fs.who !== me)) feedLoad(true);
}
// ---- statistiques personnelles : calculées par le serveur (vues, réactions, réponses, abonnés par jour, meilleurs posts, heures actives) ----
const st = { data: null, loaded: false, days: 14, busy: false };
async function statsLoad() {
  if (st.busy) return; st.busy = true;
  try { st.data = await sync.get(`/api/stats?days=${st.days}&tz=${new Date().getTimezoneOffset()}`); } catch (e) { err = e.message; }
  st.busy = false; st.loaded = true; if (view.page === 'stats') render();
}
const SERIES = [['views', '👁 Vues', '#9146ff'], ['reactions', '♥ Réactions', '#ff4d8d'], ['replies', '💬 Réponses', '#00a3ff'], ['followers', '➕ Nouveaux abonnés', '#2a9d4a']];
const nfmt = n => I18n.num(n);
function barChart(vals, labels, color, title) {
  const max = Math.max(1, ...vals);
  return `<div class="bars" role="img" aria-label="${esc(title)} : ${vals.map((v, i) => labels[i] + ' ' + v).join(', ')}">${vals.map((v, i) => `<span class="bar" title="${esc(labels[i])} : ${v}" style="height:${Math.max(v ? 4 : 1, Math.round(v / max * 100))}%;background:${color}"></span>`).join('')}</div>`;
}
function statsPage(e) {
  if (!st.loaded) { statsLoad(); return '<div class="card"><h2>📈 Statistiques de mes publications</h2><p class="mut" role="status">Chargement…</p></div>'; }
  const d = st.data; if (!d) return `<div class="card"><h2>📈 Statistiques</h2>${e}<button data-statsgo="${st.days}">Réessayer</button></div>`;
  const dl = d.series.map(x => I18n.date(new Date(x.day + 'T12:00:00Z').getTime(), { day: 'numeric', month: 'short', timeZone: 'UTC' }));
  const hmax = Math.max(1, ...d.hours), best = d.hours.map((v, h) => [v, h]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).filter(x => x[0] > 0).slice(0, 3).map(x => x[1]);
  const tiles = SERIES.map(([k, l, c]) => `<div class="card tile"><span class="mut">${l}</span><b style="color:${c}">${nfmt(d.totals[k])}</b><span class="mut">sur ${d.days} jours</span></div>`).join('');
  const charts = SERIES.map(([k, l, c]) => `<div class="card"><b>${l} par jour</b>${barChart(d.series.map(x => x[k]), dl, c, l + ' par jour')}<div class="axis"><span>${dl[0]}</span><span>${dl[dl.length - 1]}</span></div></div>`).join('');
  const top = d.top.map((p, i) => `<div class="card toppost" data-open="${p.id}"><b class="rank">#${i + 1}</b> <span>${esc(p.text.slice(0, 120) || '📷 (image)')}</span><br><span class="mut">👁 ${nfmt(p.views)} · ♥ ${nfmt(p.reactions)} · 💬 ${nfmt(p.replies)} · ${ago(p.at)}</span></div>`).join('') || '<p class="mut">Aucun post n’a encore reçu de vues ou de réactions sur cette période : publie, et les chiffres arrivent en direct.</p>';
  const heat = d.hours.map((v, h) => `<span class="hh" title="${h} h : ${v} interaction${v > 1 ? 's' : ''}" style="opacity:${v ? (0.2 + 0.8 * v / hmax).toFixed(2) : 0.08}"><i>${h}</i></span>`).join('');
  return `<div class="card"><h2>📈 Statistiques de mes publications</h2>
    <p class="mut">${d.total.posts} post${d.total.posts > 1 ? 's' : ''} publié${d.total.posts > 1 ? 's' : ''} · ${d.total.followers} abonné${d.total.followers > 1 ? 's' : ''} au total · mis à jour en direct.</p>
    <div class="tabs" role="group" aria-label="Période">${[7, 14, 30, 90].map(n => `<button data-statsgo="${n}" class="${d.days === n ? 'on' : ''}" aria-pressed="${d.days === n}">${n} jours</button>`).join('')}</div>${e}</div>
    <div class="tiles">${tiles}</div>${charts}
    <div class="card"><h3>🏆 Mes meilleurs posts</h3><p class="mut">Classés par vues + 5 × réactions + 8 × réponses.</p>${top}</div>
    <div class="card"><h3>🕒 Quand mon audience est active</h3><div class="heat" role="img" aria-label="Activité par heure : ${d.hours.map((v, h) => h + ' h ' + v).join(', ')}">${heat}</div>
    <p>${best.length ? `Ton audience est la plus active à <b>${best.map(h => h + ' h').join(', ')}</b> — idéal pour publier juste avant.` : '<span class="mut">Pas encore assez d’activité pour dégager des heures de pointe.</span>'}</p></div>`;
}
// vues : un post affiché à l'écran (≥ 50 % visible) est signalé au serveur, qui ignore l'auteur et compte une vue par heure et par lecteur
const seenQ = new Set(), sentAt = {}; let seenTimer = 0;
const viewObs = new IntersectionObserver(es => {
  for (const x of es) if (x.isIntersecting) { viewObs.unobserve(x.target); const id = +x.target.dataset.pid; if (id && !(sentAt[id] > Date.now() - 3600000)) { sentAt[id] = Date.now(); seenQ.add(id); } }
  if (seenQ.size && !seenTimer) seenTimer = setTimeout(() => { seenTimer = 0; const ids = [...seenQ]; seenQ.clear(); if (me) sync.send('/api/view', { ids }).catch(() => {}); }, 1500);
}, { threshold: 0.5 });
const watchViews = () => { if (me) document.querySelectorAll('#app .post[data-pid]').forEach(x => { if (x.dataset.w !== '1') { x.dataset.w = '1'; viewObs.observe(x); } }); };
document.addEventListener('click', ev => { const b = ev.target.closest('[data-statsgo]'); if (b) { st.days = +b.dataset.statsgo || 14; st.loaded = false; statsLoad(); render(); } });
// ---- jetons d'API & webhooks : tout est stocké côté serveur, la page ne garde que la dernière lecture ----
const dev = { data: null, loaded: false, fresh: null, detail: null, secrets: {} };
async function devLoad() {
  try { dev.data = await sync.get('/api/dev'); dev.loaded = true; } catch (e) { err = e.message; dev.loaded = true; }
  if (view.page === 'dev') { const k = document.activeElement && document.activeElement.id; if (!/^dv-/.test(k || '')) refresh(); }
}
const dt = ms => ms ? I18n.dateTime(ms) : '—';
const EVLAB = { mention: '💬 nouvelle mention', follow: '➕ nouvel abonné', ping: '🏓 ping' };
function devPage(e) {
  if (!dev.loaded) { devLoad(); return '<p class="mut" role="status">Chargement…</p>'; }
  const d = dev.data || { tokens: [], hooks: [], log: [], events: [] }, base = location.origin;
  const tokens = d.tokens.map(t => `<div class="card"><b>🔑 ${esc(t.label)}</b> <code>${esc(t.prefix)}…</code> <span class="mut">${t.scopes.map(s => s === 'read' ? 'lecture' : 'publication').join(' + ')} · créé ${dt(t.created)} · ${t.last_used ? 'utilisé ' + t.uses + '× (dernier : ' + dt(t.last_used) + ')' : 'jamais utilisé'}</span>
    <button data-dvrevoke="${t.id}" aria-label="Révoquer le jeton ${esc(t.label)}">🗑 Révoquer</button></div>`).join('') || '<p class="mut">Aucun jeton : crée-en un pour publier ou lire depuis un script.</p>';
  const hooks = d.hooks.map(h => `<div class="card"><b>${h.active ? '🟢' : '⏸'} ${esc(h.url)}</b> <span class="mut">${h.events.map(x => EVLAB[x]).join(', ')}${h.fails ? ' · ' + h.fails + ' échec' + (h.fails > 1 ? 's' : '') + ' de suite' : ''}</span>
    ${!h.active && h.fails >= 10 ? '<p class="err">Désactivé après 10 échecs consécutifs.</p>' : ''}
    <p class="mut">Secret de signature : <code>${esc(h.secret)}</code></p>
    <div class="row"><button data-dvtest="${h.id}:ping">🏓 Tester (ping)</button><button data-dvtest="${h.id}:mention">💬 Tester mention</button><button data-dvtest="${h.id}:follow">➕ Tester abonné</button>
    <button data-dvtoggle="${h.id}">${h.active ? '⏸ Mettre en pause' : '▶ Réactiver'}</button><button data-dvhookdel="${h.id}">🗑 Supprimer</button></div></div>`).join('') || '<p class="mut">Aucun webhook déclaré.</p>';
  const log = d.log.map(l => `<tr class="${l.ok ? 'ok' : 'err'}"><td>${l.ok ? '✅' : '❌'}</td><td>${dt(l.at)}</td><td>${EVLAB[l.event] || esc(l.event)}${l.test ? ' <span class="mut">(test)</span>' : ''}</td><td>${esc((d.hooks.find(h => h.id === l.hook) || {}).url || 'webhook supprimé')}</td>
    <td>${l.status || '—'}${l.error ? ' · ' + esc(l.error) : ''}</td><td>${l.ms == null ? '' : l.ms + ' ms'}</td><td><button data-dvdetail="${l.id}">Détails</button> <button data-dvredo="${l.id}">↻ Renvoyer</button></td></tr>`).join('');
  const det = dev.detail ? `<div class="card"><b>Envoi n°${dev.detail.id}</b> <button data-dvclose>Fermer</button><p class="mut">Corps envoyé</p><pre>${esc(JSON.stringify(JSON.parse(dev.detail.payload), null, 2))}</pre><p class="mut">Réponse du serveur distant</p><pre>${esc(dev.detail.response || '(vide)')}</pre></div>` : '';
  return `<div class="card"><h2>🔑 Jetons d’API & webhooks</h2><p class="mut">Des jetons personnels (révocables à tout moment) pour publier ou lire via l’API, et des webhooks appelés quand tu reçois une mention ou un nouvel abonné.</p></div>${e}${dev.fresh ? `<div class="card" role="status"><b class="ok">Jeton créé — copie-le maintenant, il ne sera plus jamais affiché :</b><br><code id="dv-new">${esc(dev.fresh)}</code> <button data-dvcopy>Copier</button></div>` : ''}
    <div class="card"><b>Nouveau jeton</b><input id="dv-label" maxlength="40" placeholder="Nom (ex. bot de stream)" aria-label="Nom du jeton">
      <label class="inl"><input type="checkbox" id="dv-read" checked> lecture (fil, mentions, abonnés)</label> <label class="inl"><input type="checkbox" id="dv-write"> publication de posts</label> <button data-dvnew>Générer le jeton</button></div>
    <div class="card"><b>Mes jetons (${d.tokens.length})</b></div>${tokens}
    <div class="card"><b>Utiliser l’API</b><pre>curl -H "Authorization: Bearer cnch_…" ${esc(base)}/api/v1/mentions
curl -H "Authorization: Bearer cnch_…" -H "Content-Type: application/json" \\
  -d '{"text":"Bonjour depuis l’API 🥒"}' ${esc(base)}/api/v1/posts</pre><p class="mut">Routes : <code>GET /api/v1/me</code>, <code>/feed</code>, <code>/mentions</code>, <code>/followers</code> (lecture) · <code>POST /api/v1/posts</code> (publication) · 60 requêtes par minute et par jeton.</p></div>
    <div class="card"><b>Nouveau webhook</b><input id="dv-url" maxlength="300" placeholder="https://exemple.org/mon-webhook" aria-label="Adresse du webhook" autocomplete="off">
      ${d.events.map(x => `<label class="inl"><input type="checkbox" class="dv-ev" value="${x}" checked> ${EVLAB[x]}</label>`).join(' ')} <button data-dvhook>Déclarer le webhook</button>
      <p class="mut">Chaque envoi est un POST JSON signé : en-tête <code>X-Cornichon-Signature: sha256=HMAC(secret, corps)</code>. Les adresses internes sont refusées.</p></div>
    <div class="card"><b>Mes webhooks (${d.hooks.length})</b></div>${hooks}
    <div class="card"><b>📜 Journal des envois</b> <span class="mut">(100 derniers)</span>${log ? `<div class="scroll"><table class="dvlog"><thead><tr><th></th><th>Date</th><th>Évènement</th><th>Webhook</th><th>Statut</th><th>Durée</th><th></th></tr></thead><tbody>${log}</tbody></table></div>` : '<p class="mut">Aucun envoi pour l’instant : utilise un bouton « Tester ».</p>'}</div>${det}`;
}
// ---- communautés thématiques ----
const ROLES = { owner: '👑 propriétaire', mod: '🛡 modérateur', member: 'membre', pending: '⏳ demande envoyée', invited: '✉️ invité' };
const gcount = g => g.count != null ? g.count : g.members.length;
const gbadge = g => g.public ? '🌐 publique' : '🔒 privée';
function groupActions(g, r) {
  return r === 'owner' ? '' : r === 'mod' || r === 'member' ? `<button data-cmleave="${g.id}">Quitter</button>`
    : r === 'pending' ? `<button data-cmleave="${g.id}">Annuler la demande</button>`
    : r === 'invited' ? `<button data-cmrespond="${g.id}:1">✔ Accepter l’invitation</button> <button data-cmrespond="${g.id}:0">Refuser</button>`
    : g.public ? `<button data-cmjoin="${g.id}">＋ Rejoindre</button>` : `<button data-cmjoin="${g.id}">🔑 Demander à rejoindre</button>`;
}
function groupsPage(e) {
  const all = net.groups(), role = g => net.groupRole(me, g.id), q = (view.q || '').toLowerCase();
  const invited = all.filter(g => role(g) === 'invited'), mine = all.filter(g => ['owner', 'mod', 'member'].includes(role(g))), rest = all.filter(g => !mine.includes(g) && !invited.includes(g) && (!q || (g.name + ' ' + g.desc).toLowerCase().includes(q)));
  const row = g => `<div class="card person"><b>${esc(g.name)}</b> <span class="mut">${gbadge(g)} · ${gcount(g)} membre${gcount(g) > 1 ? 's' : ''}${role(g) ? ' · ' + ROLES[role(g)] : ''}</span><br><span class="mut">${esc(g.desc) || 'Pas de description'}</span><div class="row"><button data-cmopen="${g.id}">Ouvrir</button> ${groupActions(g, role(g))}</div></div>`;
  return `<div class="card"><h2>👥 Communautés</h2><p class="mut">Des groupes thématiques, publics (adhésion libre) ou privés (sur demande ou invitation), avec leurs règles, leurs modérateurs et leur propre fil.</p>
    <b>Créer une communauté</b>
    <input id="g-name" maxlength="40" placeholder="Nom (ex. Speedrun, Jardinage…)" aria-label="Nom de la communauté">
    <input id="g-desc" maxlength="160" placeholder="Description (de quoi parle-t-on ici ?)" aria-label="Description">
    <textarea id="g-rules" maxlength="600" placeholder="Règles de la communauté (une par ligne)" aria-label="Règles"></textarea>
    <label class="inl"><input type="checkbox" id="g-pub" checked> publique (décoche pour une communauté privée sur demande)</label> <button data-cmnew>Créer la communauté</button></div>${e}`
    + (invited.length ? `<div class="card"><b>✉️ Invitations reçues (${invited.length})</b></div>` + invited.map(row).join('') : '')
    + `<div class="card"><b>Mes communautés (${mine.length})</b></div>` + (mine.map(row).join('') || '<p class="mut">Tu n’es dans aucune communauté : crée la première ou rejoins-en une ci-dessous.</p>')
    + `<div class="card"><b>Découvrir</b> <input id="g-q" placeholder="Filtrer par nom ou sujet" value="${esc(view.q || '')}" aria-label="Filtrer les communautés"></div>` + (rest.map(row).join('') || '<p class="mut">Rien à découvrir pour l’instant.</p>');
}
document.addEventListener('input', ev => { if (ev.target.id === 'adm-q') { adm.q = ev.target.value; const p = ev.target.selectionStart; refresh(); const x = document.getElementById('adm-q'); if (x) { x.focus(); x.setSelectionRange(p, p); } } });
document.addEventListener('input', ev => { if (ev.target.id === 'g-q') { view.q = ev.target.value; const p = ev.target.selectionStart; refresh(); const x = document.getElementById('g-q'); if (x) { x.focus(); x.setSelectionRange(p, p); } } });
function groupPage(e, paged) {
  let g; try { g = net.group(view.arg); } catch (x) { return '<div class="card"><p class="mut">Cette communauté n’existe pas ou a été supprimée.</p><button data-page="groups">Communautés</button></div>'; }
  const r = net.groupRole(me, g.id), member = ['owner', 'mod', 'member'].includes(r), mod = r === 'owner' || r === 'mod', tab = view.tab || 'feed', owner = r === 'owner';
  const reqs = g.requests.filter(n => n !== me).length;
  const tabs = [['feed', '📰 Fil'], ['members', `👥 Membres ${gcount(g)}`], ['rules', '📜 Règles']].concat(mod ? [['manage', `🛠 Gestion ${reqs || ''}`]] : []);
  const head = `<div class="card"><p><button data-page="groups">← Communautés</button></p><h2>${g.public ? '🌐' : '🔒'} ${esc(g.name)}</h2><p>${esc(g.desc) || '<span class="mut">Pas de description</span>'}</p>
    <p class="mut">${gbadge(g)} · ${gcount(g)} membre${gcount(g) > 1 ? 's' : ''} · créée par @${esc(g.owner)}${r ? ' · tu es ' + ROLES[r] : ''}</p><div class="row">${groupActions(g, r)}</div></div>
    <div class="card tabs" role="tablist" aria-label="Sections de la communauté">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}" data-cmtab="${k}">${l}</button>`).join('')}</div>${e}`;
  const person = n => { const rl = g.owner.toLowerCase() === n.toLowerCase() ? 'owner' : g.mods.some(m => m.toLowerCase() === n.toLowerCase()) ? 'mod' : 'member';
    return `<div class="card person"><span class="who" data-user="${esc(n)}">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)} · ${ROLES[rl]}</span></span>
    ${mod && rl !== 'owner' && n !== me && (rl === 'member' || owner) ? `<button data-cmrm="${g.id}:${esc(n)}:0">Retirer</button> <button data-cmrm="${g.id}:${esc(n)}:1">Bannir</button>` : ''}${owner && rl !== 'owner' ? ` <button data-cmmod="${g.id}:${esc(n)}:${rl === 'mod' ? 0 : 1}">${rl === 'mod' ? 'Retirer des modérateurs' : '🛡 Nommer modérateur'}</button>` : ''}</div>`; };
  const canInvite = g.public ? member : mod;
  if (tab === 'rules') return head + `<div class="card"><h3>📜 Règles</h3><p class="rules">${esc(g.rules) || '<span class="mut">Aucune règle précisée.</span>'}</p><p class="mut">Modération : ${[g.owner, ...g.mods].map(n => '@' + esc(n)).join(', ')}</p></div>`;
  if (tab === 'members') {
    if (!member && !g.public) return head + '<div class="card"><p class="mut">La liste des membres est réservée aux membres.</p></div>';
    const names = [g.owner, ...g.mods, ...g.members.filter(n => n !== g.owner && !g.mods.includes(n))];
    return head + (canInvite ? `<div class="card"><b>✉️ Inviter quelqu’un</b> <input id="g-inv" placeholder="Pseudo à inviter" aria-label="Pseudo à inviter"> <button data-cminv="${g.id}">Inviter</button></div>` : '') + names.map(person).join('');
  }
  if (tab === 'manage' && mod) {
    const ok = notice ? `<p class="ok" role="status">${esc(notice)}</p>` : '';
    return head + `<div class="card"><b>📩 Demandes d’adhésion (${g.requests.length})</b></div>` + (g.requests.map(n => `<div class="card person"><span class="who" data-user="${esc(n)}">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)}</span></span> <button data-cmreq="${g.id}:${esc(n)}:1">✔ Accepter</button> <button data-cmreq="${g.id}:${esc(n)}:0">✕ Refuser</button></div>`).join('') || '<p class="mut">Aucune demande en attente.</p>')
      + `<div class="card"><b>✉️ Invitations en attente (${g.invites.length})</b>${g.invites.map(n => `<div class="row"><span>@${esc(n)}</span><button data-cmcancel="${g.id}:${esc(n)}">Annuler</button></div>`).join('') || '<p class="mut">Aucune.</p>'}</div>`
      + `<div class="card"><b>⛔ Bannis (${g.banned.length})</b>${g.banned.map(n => `<div class="row"><span>@${esc(n)}</span><button data-cmunban="${g.id}:${esc(n)}">Débannir</button></div>`).join('') || '<p class="mut">Aucun.</p>'}</div>`
      + `<div class="card"><b>✏️ Informations</b>${owner ? `<input id="g-ename" maxlength="40" value="${esc(g.name)}" aria-label="Nom de la communauté">` : ''}<input id="g-edesc" maxlength="160" value="${esc(g.desc)}" aria-label="Description"><textarea id="g-erules" maxlength="600" aria-label="Règles">${esc(g.rules)}</textarea>
        ${owner ? `<label class="inl"><input type="checkbox" id="g-epub" ${g.public ? 'checked' : ''}> publique</label> ` : ''}<button data-cmsave="${g.id}">💾 Enregistrer</button> ${owner ? `<button data-cmdel="${g.id}">🗑 Supprimer la communauté</button>` : ''}${ok}</div>`;
  }
  if (!member) return head + (g.public ? paged() : `<div class="card"><p class="mut">🔒 Communauté privée : ${r === 'pending' ? 'ta demande est en attente de validation par les modérateurs.' : r === 'invited' ? 'accepte l’invitation pour y entrer.' : 'demande à la rejoindre pour voir son fil et y publier. Lis d’abord ses règles dans l’onglet 📜.'}</p></div>`);
  const composer = `<div class="card"><textarea id="txt" maxlength="280" placeholder="Publier dans ${esc(g.name)}…" aria-label="Publier dans ${esc(g.name)}"></textarea>${attachBox('post')}${pollBox()}<div class="row"><button data-cmsend="${g.id}">Publier dans la communauté</button> <button class="lnk" data-cmtab="rules">📜 Règles</button></div></div>`;
  return head + composer + paged();
}
// ---- listes de comptes ----
function listsPage(e) {
  const mine = net.lists(me, me), rec = net.sharedLists(me);
  const received = rec.length ? `<div class="card"><b>📥 Listes reçues par lien</b></div>` + rec.map(r => `<div class="card person"><b>🔗 ${esc(r.list.name)}</b> <span class="mut">de @${esc(r.owner)} · ${r.list.members.length} compte${r.list.members.length > 1 ? 's' : ''}</span> <button data-lopen="${esc(r.owner)}:${r.list.id}">Ouvrir le fil</button> <button data-lforget="${esc(r.owner)}:${r.list.id}">Retirer</button></div>`).join('') : '';
  const row = l => `<div class="card person"><b>${l.public ? '🌐' : l.share ? '🔗' : '🔒'} ${esc(l.name)}</b> <span class="mut">${l.members.length} compte${l.members.length > 1 ? 's' : ''} · ${l.public ? 'publique' : l.share ? 'partagée par lien' : 'privée'}</span> <button data-lopen="${esc(me)}:${l.id}">Ouvrir le fil</button></div>`;
  return `<div class="card"><h2>🗂 Mes listes</h2><p class="mut">Regroupe des comptes dans des listes nommées et lis un fil dédié pour chacune. Une liste privée n’est visible que par toi ; une liste publique s’affiche sur ton profil ; une liste privée peut aussi être partagée par lien secret.</p>
    <input id="l-name" maxlength="40" placeholder="Nom de la liste (ex. Devs, Streamers…)" aria-label="Nom de la nouvelle liste"> <label><input type="checkbox" id="l-pub"> publique</label> <button data-lcreate>Créer la liste</button></div>${e}` + (mine.map(row).join('') || '<p class="mut">Aucune liste pour l’instant : crée la première ci-dessus.</p>') + received;
}
function listPage(e, paged) {
  const { owner, id } = view.arg; let l;
  try { l = net.list(owner, id, me); } catch (x) { return `<div class="card"><p class="mut">Cette liste n’existe pas ou est privée.</p><button data-page="lists">Mes listes</button></div>`; }
  const own = owner.toLowerCase() === me.toLowerCase(), who = shown(owner);
  const members = l.members.map(n => `<div class="card person" data-user="${esc(n)}">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)}</span>${own ? ` <button data-lmem="${l.id}:${esc(n)}" aria-label="Retirer ${esc(n)} de la liste">Retirer</button>` : ''}</div>`).join('') || '<p class="mut">Cette liste est vide.</p>';
  const head = `<div class="card"><h2>${l.public ? '🌐' : l.share ? '🔗' : '🔒'} ${esc(l.name)}</h2><p class="mut">Liste ${l.public ? 'publique' : l.share ? 'partagée par lien' : 'privée'} de <span class="who" data-user="${esc(owner)}">@${esc(owner)}</span> · ${l.members.length} compte${l.members.length > 1 ? 's' : ''}</p>` + (own
    ? `<p><input id="l-ren" maxlength="40" value="${esc(l.name)}" aria-label="Nom de la liste"> <button data-lren="${l.id}">Renommer</button> <button data-lpub="${l.id}">${l.public ? '🔒 Rendre privée' : '🌐 Rendre publique'}</button> <button data-ldel="${l.id}">🗑 Supprimer</button></p>
       <p>${l.share ? `🔗 <input id="l-link" readonly value="${esc(shareUrl(owner, l))}" aria-label="Lien de partage" size="40"> <button data-lcopy>Copier</button> <button data-lshare="${l.id}:renew">Nouveau lien</button> <button data-lshare="${l.id}:off">Révoquer</button>` : `<button data-lshare="${l.id}:on">🔗 Partager par lien</button> <span class="mut">Seules les personnes ayant le lien (et connectées) pourront voir cette liste.</span>`}</p>
       <p><input id="l-add" placeholder="Ajouter un compte (pseudo)" aria-label="Pseudo à ajouter"> <button data-ladd="${l.id}">Ajouter</button></p>` : '') + `</div>`;
  return (own ? tabsFor() : '') + head + e + `<div class="card"><b>Fil de la liste</b></div>` + (l.members.length ? paged() : '') + `<div class="card"><b>Comptes de la liste</b></div>` + members;
}
const shareUrl = (owner, l) => `${location.origin}/?list=${encodeURIComponent(owner)}:${l.id}:${l.share}`;
function tabsFor() { return `<p><button data-page="feed">← Mon fil</button> <button data-page="lists">🗂 Toutes mes listes</button></p>`; }
// listes publiques d'un profil (et, sur le profil d'autrui, ajout à ses propres listes)
function profileLists(name, self) {
  const pub = net.lists(name, me).filter(l => self || l.public);
  const mine = self ? [] : net.lists(me, me);
  return (pub.length ? `<div class="card"><b>🗂 Listes${self ? '' : ' publiques'}</b> ${pub.map(l => `<button data-lopen="${esc(name)}:${l.id}">${l.public ? '🌐' : '🔒'} ${esc(l.name)} (${l.members.length})</button>`).join(' ')}</div>` : '')
    + (!self ? `<div class="card"><b>Ajouter @${esc(name)} à une liste</b> ${mine.map(l => `<button data-lmem="${l.id}:${esc(name)}" aria-pressed="${l.members.some(m => m.toLowerCase() === name.toLowerCase())}">${l.members.some(m => m.toLowerCase() === name.toLowerCase()) ? '✔' : '＋'} ${esc(l.name)}</button>`).join(' ') || '<span class="mut">Crée d’abord une liste dans 🗂 Listes.</span>'}</div>` : '');
}
// accessibilité : éléments cliquables non-boutons focalisables, états ARIA, libellés
function a11yPass() {
  document.querySelectorAll('#app [data-user]:not(button),#app [data-search]:not(button),#app [data-tag]:not(button),#app [data-open]:not(button),#app [data-cmopen]:not(button)').forEach(x => { x.tabIndex = 0; x.setAttribute('role', 'button'); });
  document.querySelectorAll('#nav button').forEach(b => { if (b.classList.contains('on')) b.setAttribute('aria-current', 'page'); });
  document.querySelectorAll('#app [data-like]').forEach(b => { b.setAttribute('aria-pressed', b.classList.contains('on')); b.setAttribute('aria-label', b.textContent.trim().slice(2) + ' j’aime'); });
  document.querySelectorAll('#app [data-open]:is(button)').forEach(b => b.setAttribute('aria-label', b.textContent.trim().slice(2) + ' réponses'));
  document.querySelectorAll('#app [data-del]').forEach(b => b.setAttribute('aria-label', 'Supprimer le post'));
  document.querySelectorAll('#app [data-sub=""]').forEach(b => b.setAttribute('aria-label', 'Fermer la liste'));
  document.querySelectorAll('#app textarea:not([aria-label]):not(.json),#app input:not([aria-label]):not([type=hidden])').forEach(x => { if (!x.labels.length && x.placeholder) x.setAttribute('aria-label', x.placeholder); });
  document.querySelectorAll('#app .err').forEach(x => x.setAttribute('role', 'alert'));
}
// clavier : Entrée / Espace activent les éléments « role=button » (les vrais boutons le font déjà)
document.addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[role=button]:not(button)')) { ev.preventDefault(); ev.target.click(); }
});
const download = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };


// ---- Studio de thème ----
const hsl2hex = (h, s, l) => { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))); return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join(''); };
const TYPE_LABELS = { linear: 'Linéaire', radial: 'Radial', conic: 'Conique' }, FONT_LABELS = { system: 'Système', serif: 'Élégante', mono: 'Machine', round: 'Arrondie' };
const gradEditor = (key, title) => {
  const g = th[key];
  return `<div class="card" role="group" aria-labelledby="g-${key}"><h3 id="g-${key}">${title}</h3>
    <div class="tbar" id="bar-${key}" style="background:${Theme.css(g)}"></div>
    <div class="row"><label class="inl">Type <select data-tf="${key}.type">${Theme.TYPES.map(t => `<option value="${t}" ${g.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`).join('')}</select></label>
    ${g.type === 'radial' ? '' : `<label class="inl" style="flex:1">${g.type === 'conic' ? 'Rotation' : 'Angle'} <output id="o-${key}-angle">${g.angle}°</output><input type="range" min="0" max="360" value="${g.angle}" data-tf="${key}.angle" aria-label="Angle du dégradé ${title}"></label>`}</div>
    ${g.stops.map((s, i) => `<div class="stop"><input type="color" value="${s.c}" data-tf="${key}.stops.${i}.c" aria-label="Couleur ${i + 1}"><input type="range" min="0" max="100" value="${s.p}" data-tf="${key}.stops.${i}.p" aria-label="Position de la couleur ${i + 1}"><output id="o-${key}-${i}">${s.p}%</output><button data-trm="${key}:${i}" aria-label="Retirer la couleur ${i + 1}" ${g.stops.length <= 2 ? 'disabled' : ''}>✕</button></div>`).join('')}
    <div class="row"><button data-tadd="${key}" ${g.stops.length >= Theme.MAX_STOPS ? 'disabled' : ''}>➕ Ajouter une couleur (${g.stops.length}/${Theme.MAX_STOPS})</button><button data-trev="${key}">↔ Inverser</button></div></div>`;
};
function themePage() {
  const names = Object.keys(Theme.PRESETS);
  return `<div class="card tp" role="group" aria-labelledby="h-th"><h2 id="h-th">🎨 Studio de thème</h2>
    <p class="mut">Compose ton propre thème : dégradés à plusieurs couleurs, couleurs du texte et des cartes, forme, police, animation. Tout s’applique en direct et reste sur cet appareil.</p>
    <div class="row"><label class="inl"><input type="checkbox" data-tf="on" ${th.on ? 'checked' : ''}> Activer mon thème personnalisé</label><button data-trandom>🎲 Aléatoire</button><button data-treset>↺ Réinitialiser</button></div>
    <div class="tprev" id="tprev" style="background:${Theme.css(th.bg)}"><span class="card" style="padding:6px 10px">Aperçu <a href="#" onclick="return false">lien</a></span> <button class="on" style="margin-left:8px">Bouton</button></div>
    <b>Thèmes prêts à l’emploi</b><div class="pre">${names.map(n => `<button data-tpreset="${esc(n)}" style="background:${Theme.css(Theme.PRESETS[n].bg)}">${esc(n)}</button>`).join('')}</div></div>
    ${gradEditor('bg', '🌈 Dégradé de fond de la page')}${gradEditor('acc', '✨ Dégradé d’accent (boutons, titre, barres)')}
    <div class="card tp" role="group" aria-labelledby="h-th2"><h3 id="h-th2">🧩 Couleurs, forme et style</h3>
      <div class="row"><label class="inl">Cartes <input type="color" value="${th.card}" data-tf="card" aria-label="Couleur des cartes"></label><label class="inl">Texte <input type="color" value="${th.fg}" data-tf="fg" aria-label="Couleur du texte"></label><label class="inl">Liens <input type="color" value="${th.lnk}" data-tf="lnk" aria-label="Couleur des liens"></label></div>
      <div class="row"><label class="inl" style="flex:1">Opacité des cartes <output id="o-cardAlpha">${th.cardAlpha}%</output><input type="range" min="30" max="100" value="${th.cardAlpha}" data-tf="cardAlpha"></label><label class="inl" style="flex:1">Arrondi <output id="o-radius">${th.radius}px</output><input type="range" min="0" max="28" value="${th.radius}" data-tf="radius"></label></div>
      <div class="row"><label class="inl">Police <select data-tf="font">${Object.keys(Theme.FONTS).map(f => `<option value="${f}" ${th.font === f ? 'selected' : ''}>${FONT_LABELS[f]}</option>`).join('')}</select></label>
      <label class="inl"><input type="checkbox" data-tf="anim" ${th.anim ? 'checked' : ''}> Fond animé</label><label class="inl"><input type="checkbox" data-tf="glow" ${th.glow ? 'checked' : ''}> Lueur néon</label></div>
      <p class="mut" id="tcontrast" role="status">${contrastMsg()}</p></div>
    <div class="card tp" role="group" aria-labelledby="h-th3"><h3 id="h-th3">📤 Partager mon thème</h3><div class="row"><button data-texport>📋 Copier / exporter</button><button data-timport>📥 Importer</button></div>
      <label for="t-json">JSON du thème</label><textarea id="t-json" class="json" placeholder='{"format":"cornichon-theme",…}'>${esc(tjson)}</textarea><p class="ok" role="status">${esc(notice)}</p>${err ? `<p class="err">${esc(err)}</p>` : ''}</div>`;
}
let tjson = '';
const contrastMsg = () => { const r = Theme.ratio(th.fg, Theme.mix(th.bg)), ok = r >= 4.5; return `Contraste texte / fond : ${r.toFixed(1)}:1 ${ok ? '✔ lisible' : '⚠ faible, choisis un texte plus clair ou plus foncé'}`; };
// lecture-modification-écriture sur le thème stocké, puis application immédiate
function editTheme(fn) { th = Theme.load(store); fn(th); if (!th.on && !th._keepOff) th.on = true; th = Theme.save(store, th); applyTheme(); }
function setPath(t, path, val) {
  const k = path.split('.'); let o = t; for (let i = 0; i < k.length - 1; i++) o = o[k[i]];
  const last = k[k.length - 1], num = ['angle', 'p', 'cardAlpha', 'radius'].includes(last); o[last] = num ? +val : val;
}
function livePreview() {
  const set = (id, css) => { const e = document.getElementById(id); if (e) e.style.background = css; };
  set('tprev', Theme.css(th.bg)); set('bar-bg', Theme.css(th.bg)); set('bar-acc', Theme.css(th.acc));
  const c = $('#tcontrast'); if (c) c.textContent = contrastMsg();
}
document.addEventListener('input', ev => {
  if (ev.target.id === 'dm' && view.arg && Date.now() - lastTyped > 2000) { lastTyped = Date.now(); sync.typing(view.arg); }
  const t = ev.target, path = t.dataset && t.dataset.tf; if (!path || t.tagName === 'SELECT') return;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  editTheme(x => { if (path === 'on') { x.on = val; x._keepOff = !val; } else setPath(x, path, val); });
  const o = document.getElementById('o-' + path.replace(/\.stops\./, '-').replace(/\.[cp]$/, '').replace(/^(\w+)\.angle$/, '$1-angle'));
  if (o && t.type === 'range') o.textContent = val + (/angle/.test(path) ? '°' : /radius/.test(path) ? 'px' : '%');
  if (t.type === 'checkbox') render(); else livePreview();
});
document.addEventListener('change', ev => {
  if (ev.target.dataset && ('np' in ev.target.dataset || 'npq' in ev.target.dataset)) return void savePrefs();
  const t = ev.target, path = t.dataset && t.dataset.tf; if (!path || t.tagName !== 'SELECT') return;
  editTheme(x => setPath(x, path, t.value)); render(); const n = document.querySelector(`[data-tf="${path}"]`); if (n) n.focus();
});
function themeClick(D, v) {
  if ('tpreset' in D) { const p = Theme.PRESETS[D.tpreset]; editTheme(x => Object.assign(x, { font: 'system', anim: false, glow: false }, JSON.parse(JSON.stringify(p)))); }
  else if ('tadd' in D) editTheme(x => { const g = x[D.tadd]; if (g.stops.length < Theme.MAX_STOPS) g.stops.push({ c: hsl2hex(Math.floor(Math.random() * 360), 80, 55), p: 100 }); });
  else if ('trm' in D) { const [k, i] = D.trm.split(':'); editTheme(x => { if (x[k].stops.length > 2) x[k].stops.splice(+i, 1); }); }
  else if ('trev' in D) editTheme(x => { x[D.trev].stops = x[D.trev].stops.map(s => ({ c: s.c, p: 100 - s.p })).reverse(); });
  else if ('trandom' in D) editTheme(x => {
    const h = Math.floor(Math.random() * 360), n = 2 + Math.floor(Math.random() * 3), dark = Math.random() < 0.7;
    x.bg = { type: Theme.TYPES[Math.floor(Math.random() * 3)], angle: Math.floor(Math.random() * 360), stops: Array.from({ length: n }, (_, i) => ({ c: hsl2hex((h + i * (30 + Math.random() * 50)) % 360, 60, dark ? 14 + Math.random() * 14 : 78 + Math.random() * 12), p: Math.round(i * 100 / (n - 1)) })) };
    x.acc = { type: 'linear', angle: 90, stops: [{ c: hsl2hex((h + 180) % 360, 85, 55), p: 0 }, { c: hsl2hex((h + 230) % 360, 85, 60), p: 100 }] };
    x.card = dark ? hsl2hex(h, 40, 10) : '#ffffff'; x.fg = dark ? '#f2f2fa' : '#1b1d26'; x.lnk = hsl2hex((h + 180) % 360, 90, dark ? 72 : 32);
  });
  else if ('treset' in D) { th = Theme.save(store, { on: false }); applyTheme(); }
  else if ('texport' in D) { const txt = tjson = Theme.exportText(th); try { navigator.clipboard.writeText(txt); notice = 'Thème copié ✔'; } catch (e) { notice = 'Copie le JSON ci-dessous ✔'; } }
  else if ('timport' in D) { try { tjson = v('#t-json'); th = Theme.save(store, Theme.importText(tjson)); applyTheme(); notice = 'Thème importé ✔'; err = ''; } catch (e) { err = e.message; notice = ''; } }
  if (!('texport' in D || 'timport' in D)) { notice = ''; err = ''; }
  render();
}

document.addEventListener('change', ev => {
  const k = ev.target.dataset && ev.target.dataset.notiftype; if (!k) return;
  const np = Notif.load(store); np.types[k] = ev.target.checked; Notif.save(store, np); refresh();
});
window.addEventListener('storage', ev => { if (ev.key === Notif.KEY && view.page === 'settings') refresh(); });
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-install],[data-notifmain],[data-notiftest]'); if (!b) return;
  if ('install' in b.dataset && installEv) { installEv.prompt(); await installEv.userChoice.catch(() => {}); installEv = null; refresh(); }
  else if ('notifmain' in b.dataset) {
    const np = Notif.load(store);
    if (np.enabled && perm === 'granted') np.enabled = false;
    else { perm = await Notification.requestPermission(); np.enabled = perm === 'granted'; if (np.enabled && me) Notif.seenSet(store, me, net.notifications(me).reduce((m, n) => Math.max(m, n.id), 0)); }
    Notif.save(store, np); refresh();
  } else if ('notiftest' in b.dataset) Notif.show({ id: 'test' + Date.now(), type: 'mention' }, 'Le bocal');
});
document.addEventListener('click', ev => {
  const d = ev.target.closest('*[data-atab],*[data-bkcreate],*[data-bkkeep],*[data-bkask],*[data-bkno],*[data-bkrestore],*[data-bkdl],*[data-bkdel],*[data-asanc],*[data-adelask],*[data-adelno],*[data-adel],*[data-tr],*[data-trclose],*[data-lang],*[data-page],*[data-dvnew],*[data-dvcopy],*[data-dvrevoke],*[data-dvhook],*[data-dvtoggle],*[data-dvhookdel],*[data-dvtest],*[data-dvredo],*[data-dvdetail],*[data-dvclose],*[data-sfollow],*[data-sdismiss],*[data-plan],*[data-drplan],*[data-drunplan],*[data-drpub],*[data-drdel],*[data-restore],*[data-diag],*[data-like],*[data-react],*[data-picker],*[data-rwho],*[data-quote],*[data-sendquote],*[data-cancelquote],*[data-open],*[data-del],*[data-send],*[data-pollon],*[data-polloff],*[data-polladd],*[data-pollrm],*[data-vote],*[data-newposts],*[data-more],*[data-user],*[data-search],*[data-tag],*[data-trange],*[data-topic],*[data-login],*[data-mfago],*[data-mfaback],*[data-signup],*[data-logout],*[data-follow],*[data-chat],*[data-dm],*[data-dosearch],*[data-sfapply],*[data-sssave],*[data-ssdel],*[data-ssopen],*[data-sub],*[data-grad],*[data-saveprofile],*[data-chpw],*[data-forgot],*[data-doforgot],*[data-backlogin],*[data-doreset],*[data-endlink],*[data-setmail],*[data-rmmail],*[data-logoutall],*[data-delacc],*[data-theme],*[data-size],*[data-export],*[data-import],*[data-bm],*[data-repost],*[data-edit],*[data-saveedit],*[data-canceledit],*[data-hist],*[data-gal],*[data-rmimg],*[data-lbclose],*[data-lbnav],*[data-tpreset],*[data-tadd],*[data-trm],*[data-trev],*[data-trandom],*[data-treset],*[data-texport],*[data-timport],*[data-report],*[data-appeal],*[data-cancelappeal],*[data-sendappeal],*[data-decide],*[data-sendreport],*[data-cancelreport],*[data-block],*[data-mute],*[data-unblock],*[data-unmute],*[data-mod],*[data-lift],*[data-cmopen],*[data-cmnew],*[data-cmjoin],*[data-cmleave],*[data-cmreq],*[data-cminv],*[data-cmrespond],*[data-cmcancel],*[data-cmrm],*[data-cmunban],*[data-cmmod],*[data-cmtab],*[data-cmsave],*[data-cmdel],*[data-cmsend],*[data-lopen],*[data-lshare],*[data-lcopy],*[data-lforget],*[data-lcreate],*[data-lpub],*[data-lren],*[data-ldel],*[data-ladd],*[data-lmem]');
  if (!d || d === document.documentElement || d === document.body) return;   // <html data-theme> ne doit pas déclencher d'action (sinon chaque clic re-rendait la page et effaçait le focus des champs)
  const D = d.dataset, v = id => ($(id) || {}).value;
  if (Object.keys(D).some(k => /^t(preset|add|rm|rev|random|reset|export|import)$/.test(k))) themeClick(D, v);
  else if ('dvnew' in D) attempt(async () => { const sc = ['read', 'write'].filter(s => $('#dv-' + s).checked); const r = await sync.send('/api/dev/token', { label: v('#dv-label'), scopes: sc }); dev.fresh = r.token; await devLoad(); });
  else if ('dvcopy' in D) { try { navigator.clipboard.writeText(dev.fresh); notice = 'Jeton copié ✔'; } catch (x) { notice = 'Sélectionne le jeton pour le copier'; } render(); }
  else if ('dvrevoke' in D) { if (confirm('Révoquer ce jeton ? Les scripts qui l’utilisent cesseront de fonctionner.')) attempt(async () => { await sync.send('/api/dev/token-revoke', { id: +D.dvrevoke }); dev.fresh = null; await devLoad(); }); }
  else if ('dvhook' in D) attempt(async () => { await sync.send('/api/dev/hook', { url: v('#dv-url'), events: [...document.querySelectorAll('.dv-ev')].filter(x => x.checked).map(x => x.value) }); await devLoad(); });
  else if ('dvtoggle' in D) attempt(async () => { const h = dev.data.hooks.find(x => x.id === +D.dvtoggle); await sync.send('/api/dev/hook-update', { id: h.id, active: !h.active }); await devLoad(); });
  else if ('dvhookdel' in D) { if (confirm('Supprimer ce webhook et son journal ?')) attempt(async () => { await sync.send('/api/dev/hook-delete', { id: +D.dvhookdel }); await devLoad(); }); }
  else if ('dvtest' in D) attempt(async () => { const [id, event] = D.dvtest.split(':'); const r = await sync.send('/api/dev/hook-test', { id: +id, event }); await devLoad(); if (!r.ok) throw new Error('Test échoué : ' + r.error); });
  else if ('dvredo' in D) attempt(async () => { const r = await sync.send('/api/dev/redeliver', { id: +D.dvredo }); await devLoad(); if (!r.ok) throw new Error('Renvoi échoué : ' + r.error); });
  else if ('dvdetail' in D) attempt(async () => { dev.detail = await sync.get('/api/dev/delivery?id=' + D.dvdetail); });
  else if ('dvclose' in D) { dev.detail = null; render(); }
  else if ('diag' in D) runDiag();
  else if ('login' in D) attempt(async () => { const name = v('#u'), pw = v('#pw'), r = await net.login(name, pw); if (r && r.mfa) mfa = { name, password: pw }; else openSession(r); });
  else if ('mfago' in D) attempt(async () => { const r = await net.login(mfa.name, mfa.password, v('#mfa-code'), !!($('#mfa-trust') || {}).checked); mfa = null; openSession(r); });
  else if ('mfaback' in D) { mfa = null; err = ''; render(); }
  else if ('signup' in D) attempt(async () => openSession(await net.signup(v('#u'), v('#pw'), v('#bio'))));
  else if ('logout' in D) { me = null; sync.logout(); clearOffline(); if (STREAM) attempt(async () => openSession(await net.ensureStreamer())); go('feed'); }
  else if ('chpw' in D) attempt(async () => {
    if (v('#sec-new') !== v('#sec-new2')) throw new Error('La confirmation ne correspond pas');
    await net.changePassword(me, v('#sec-old'), v('#sec-new')); view = { page: 'security', ok: 'Mot de passe modifié ✔ (autres appareils déconnectés)' };
  });
  else if ('forgot' in D) { authMode = 'forgot'; err = ''; notice = ''; render(); }
  else if ('backlogin' in D) { authMode = 'login'; err = ''; notice = ''; render(); }
  else if ('doforgot' in D) attempt(async () => { await net.forgot(null, v('#fg-id')); notice = 'Si un compte correspond à une adresse vérifiée, un lien vient d\'être envoyé ✔'; });
  else if ('doreset' in D) attempt(async () => {
    if (v('#rs-pw') !== v('#rs-pw2')) throw new Error('La confirmation ne correspond pas');
    const r = await net.reset(LINK.token, v('#rs-pw')); linkMsg = `Mot de passe de @${r.name} modifié ✔ — toutes les sessions ont été fermées, reconnectez-vous.`; me = null; sync.logout();
  });
  else if ('endlink' in D) { LINK = null; linkMsg = ''; authMode = 'login'; err = ''; render(); }
  else if ('setmail' in D) attempt(async () => { const r = await net.setEmail(me, v('#sec-mail')); view = { page: 'security', ok: r.verified ? 'Cette adresse est déjà vérifiée ✔' : `Lien de confirmation envoyé à ${r.email} ✔` }; });
  else if ('rmmail' in D) attempt(async () => { await net.removeEmail(me); view = { page: 'security', ok: 'Adresse retirée ✔' }; });
  else if ('logoutall' in D) attempt(async () => { await net.logoutAll(me); clearOffline(); me = null; view = { page: 'feed' }; });
  else if ('delacc' in D) attempt(async () => {
    if (!confirm('Supprimer définitivement votre compte et tous vos posts ?')) return;
    await net.deleteAccount(me, v('#sec-del')); me = null; view = { page: 'feed' };
  });
  else if ('lang' in D) { langPref = I18n.save(store, D.lang); applyLang(); notice = t('lang.changed', { n: langName(I18n.get()) }); render(); }
  else if ('theme' in D) { prefs = A11y.save(store, { theme: D.theme }); applyPrefs(); render(); }
  else if ('size' in D) { const i = A11y.SIZES.indexOf(prefs.size), j = D.size === '0' ? A11y.SIZES.indexOf(100) : Math.max(0, Math.min(A11y.SIZES.length - 1, i + +D.size)); prefs = A11y.save(store, { size: A11y.SIZES[j] }); applyPrefs(); render(); }
  else if ('export' in D) attempt(async () => { download(`cornichon-${me}.json`, JSON.stringify(await net.exportUser(me), null, 2)); notice = 'Export téléchargé ✔'; });
  else if ('import' in D) attempt(async () => {
    const f = ($('#imp-file') || {}).files && $('#imp-file').files[0], txt = f ? await f.text() : v('#imp-txt');
    const r = await net.importUser(me, txt); notice = `Import réussi ✔ : ${r.posts} post(s), ${r.messages} message(s), ${r.following} abonnement(s)`;
  });
  else if ('gal' in D) {
    const [k, i, j] = D.gal.split(':'), it = k === 'p' ? net.db().posts.find(x => x.id === +i) : net.db().messages.find(x => x.id === +i);
    if (it && it.images) { lb = { images: it.images, i: +j, from: D.gal }; lightbox(); }
  }
  else if ('rmimg' in D) { const [k, i] = D.rmimg.split(':'); pend[k].splice(+i, 1); err = ''; refresh(); }
  else if ('lbclose' in D) closeLb();
  else if ('lbnav' in D) { lb.i = (lb.i + +D.lbnav + lb.images.length) % lb.images.length; lightbox(); }
  else if ('page' in D) { err = ''; notice = ''; draftMsg = ''; go(D.page); $('#app').focus(); }
  else if ('pollon' in D) { pollRead(); pollDraft.on = true; rerender(); }
  else if ('polloff' in D) { pollReset(); rerender(); }
  else if ('polladd' in D) { pollRead(); if (pollDraft.opts.length < 4) pollDraft.opts.push(''); rerender(); }
  else if ('pollrm' in D) { pollRead(); if (pollDraft.opts.length > 2) pollDraft.opts.pop(); rerender(); }
  else if ('vote' in D) { const [pid, ch] = D.vote.split(':').map(Number); attempt(() => net.vote(me, pid, ch)); }
  else if ('send' in D) attempt(async () => {
    clearTimeout(dtimers.new); let poll = null;
    if (!D.send && pollDraft.on) { pollRead(); poll = { options: pollDraft.opts, minutes: pollDraft.minutes }; }
    await net.post(me, v('#txt'), D.send ? +D.send : null, pend.post, poll); pend.post = []; if (poll) pollReset();
    if (!D.send && curDraft) { const id = curDraft; curDraft = null; await net.deleteDraft(me, id).catch(() => {}); }
    if (feedScope()) feedLoad(true);
  });
  else if ('plan' in D) attempt(async () => {
    const at = new Date(v('#plan-at')).getTime(); if (!at) throw new Error('Choisissez une date de publication');
    clearTimeout(dtimers.new); await net.saveDraft(me, curDraft, v('#txt'), pend.post, { scheduledAt: at });
    curDraft = null; pend.post = []; draftMsg = 'Publication planifiée ✔ le ' + when(at); go('drafts');
  });
  else if ('drplan' in D) attempt(async () => {
    const id = +D.drplan, at = new Date(v('#dr-at-' + id)).getTime(); if (!at) throw new Error('Choisissez une date de publication');
    clearTimeout(dtimers[id]); await net.saveDraft(me, id, v('#dr-txt-' + id), net.drafts(me).find(x => x.id === id).images, { scheduledAt: at }); draftMsg = 'Publication planifiée ✔ le ' + when(at);
  });
  else if ('drunplan' in D) attempt(async () => { const id = +D.drunplan; await net.saveDraft(me, id, v('#dr-txt-' + id), net.drafts(me).find(x => x.id === id).images, { scheduledAt: null }); draftMsg = 'Planification retirée ✔'; });
  else if ('drpub' in D) attempt(async () => {
    const id = +D.drpub; clearTimeout(dtimers[id]); await net.saveDraft(me, id, v('#dr-txt-' + id), net.drafts(me).find(x => x.id === id).images, {});
    await net.publishDraft(me, id); draftMsg = 'Brouillon publié ✔';
  });
  else if ('drdel' in D) attempt(async () => { clearTimeout(dtimers[+D.drdel]); await net.deleteDraft(me, +D.drdel); draftMsg = 'Brouillon supprimé ✔'; });
  else if ('restore' in D) { const [i, j] = D.restore.split(':'), p = net.db().posts.find(x => x.id === +i); if (p) { view.editing = p.id; view.hist = p.id; view.restore = { id: p.id, text: p.history[+j].text }; render(); } }
  else if ('newposts' in D) { feedLoad(true); window.scrollTo({ top: 0 }); }
  else if ('more' in D) feedLoad();
  else if ('like' in D) attempt(() => net.toggleLike(me, +D.like));
  else if ('react' in D) { const [i, em] = D.react.split('|'); view.picker = null; attempt(() => net.react(me, +i, em)); }
  else if ('picker' in D) { view.picker = view.picker === +D.picker ? null : +D.picker; render(); }
  else if ('rwho' in D) { view.rwho = view.rwho === +D.rwho ? null : +D.rwho; render(); }
  else if ('quote' in D) { view.quoting = view.quoting === +D.quote ? null : +D.quote; render(); const q = $('#quote-txt'); if (q) q.focus(); }
  else if ('cancelquote' in D) { view.quoting = null; render(); }
  else if ('sendquote' in D) attempt(async () => { await net.quote(me, +D.sendquote, v('#quote-txt')); view.quoting = null; });
  else if ('bm' in D) attempt(() => net.toggleBookmark(me, +D.bm));
  else if ('repost' in D) attempt(() => net.toggleRepost(me, +D.repost));
  else if ('edit' in D) { view.editing = +D.edit; render(); const t = $('#edit-txt'); if (t) t.focus(); }
  else if ('canceledit' in D) { view.editing = null; view.restore = null; render(); }
  else if ('saveedit' in D) attempt(async () => { await net.editPost(me, +D.saveedit, v('#edit-txt')); view.editing = null; view.restore = null; });
  else if ('hist' in D) { view.hist = view.hist === +D.hist ? null : +D.hist; render(); }
  else if ('report' in D) { view.reporting = +D.report; err = ''; render(); const x = $('#rp-reason'); if (x) x.focus(); }
  else if ('cancelreport' in D) { view.reporting = null; render(); }
  else if ('appeal' in D) { view.appealing = D.appeal; err = ''; render(); const x = $('#ap-text'); if (x) x.focus(); }
  else if ('cancelappeal' in D) { view.appealing = null; render(); }
  else if ('sendappeal' in D) attempt(async () => { const [k, pid] = D.sendappeal.split(':'); await net.appeal(me, k, pid ? +pid : null, v('#ap-text')); view.appealing = null; notice = ''; });
  else if ('decide' in D) attempt(async () => { const [aid, ok] = D.decide.split(':'); await net.decideAppeal(me, +aid, ok === '1', v('#ap-ans-' + aid)); });
  else if ('sendreport' in D) attempt(async () => { await net.report(me, +D.sendreport, v('#rp-reason'), v('#rp-note')); view.reporting = null; notice = ''; });
  else if ('block' in D) attempt(() => net.toggleBlock(me, D.block));
  else if ('unblock' in D) attempt(() => net.toggleBlock(me, D.unblock));
  else if ('mute' in D) attempt(() => net.toggleMute(me, D.mute));
  else if ('unmute' in D) attempt(() => net.toggleMute(me, D.unmute));
  else if ('lift' in D) attempt(() => net.liftSanction(me, D.lift));
  else if ('atab' in D) { adm.tab = D.atab; adm.del = null; adm.rest = null; adm.bkMsg = ''; if (D.atab === 'backups') adm.bk = null; err = ''; render(); }
  else if ('bkcreate' in D) attempt(async () => { adm.bk = await sync.send('/api/admin/backups/create', {}); adm.bkMsg = 'Sauvegarde créée ✔'; });
  else if ('bkkeep' in D) attempt(async () => { adm.bk = await sync.send('/api/admin/backups/keep', { keep: +v('#bk-keep') }); adm.bkMsg = 'Rotation : ' + adm.bk.keep + ' sauvegarde(s) automatique(s) conservée(s) ✔'; });
  else if ('bkask' in D) { adm.rest = D.bkask; adm.bkMsg = ''; render(); }
  else if ('bkno' in D) { adm.rest = null; render(); }
  else if ('bkrestore' in D) attempt(async () => { const r = await sync.send('/api/admin/backups/restore', { id: D.bkrestore, confirm: true }); adm.bk = r; adm.rest = null; adm.bkMsg = 'Données restaurées ✔ (copie de sécurité : ' + r.safety + ')'; await sync.pull(true); });
  else if ('bkdl' in D) attempt(async () => { const blob = await sync.blob('/api/admin/backups/' + encodeURIComponent(D.bkdl) + '/download'), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = D.bkdl; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); });
  else if ('bkdel' in D) { if (confirm('Supprimer définitivement cette sauvegarde ?')) attempt(async () => { adm.bk = await sync.send('/api/admin/backups/delete', { id: D.bkdel }); adm.bkMsg = 'Sauvegarde supprimée'; }); }
  else if ('asanc' in D) attempt(async () => { const i = D.asanc.lastIndexOf(':'); await net.adminSanction(me, D.asanc.slice(0, i), D.asanc.slice(i + 1), v('#adm-h'), v('#adm-r')); });
  else if ('adelask' in D) { adm.del = D.adelask; render(); }
  else if ('adelno' in D) { adm.del = null; render(); }
  else if ('adel' in D) attempt(async () => { await net.adminDeleteUser(me, D.adel, v('#adm-r')); adm.del = null; });
  else if ('mod' in D) attempt(async () => { const [pid, act] = D.mod.split(':'); await net.moderate(me, +pid, act, { hours: v('#mh-' + pid) }); });
  else if ('del' in D) attempt(() => net.deletePost(me, +D.del));
  else if ('open' in D) go('thread', +D.open);
  else if ('sub' in D) { const [k, n] = D.sub.split(':'); view = { page: 'profile', arg: n, sub: k || null }; render(); }
  else if ('grad' in D) { $('#s-gradv').value = 'grad:' + D.grad; $('#s-banner').value = ''; $('#pvb').style.background = GRADS[+D.grad]; }
  else if ('saveprofile' in D) attempt(async () => { await net.updateProfile(me, { display: v('#s-display'), bio: v('#s-bio'), avatar: v('#s-avatar'), banner: v('#s-banner') || v('#s-gradv'), link: v('#s-link') }); if (!err) view = { page: 'profile' }; });
  else if ('lopen' in D) { const [o, i] = D.lopen.split(':'); err = ''; go('list', { owner: o, id: +i }); }
  else if ('lcreate' in D) attempt(async () => { const l = await net.createList(me, v('#l-name'), $('#l-pub').checked); go('list', { owner: me, id: l.id }); });
  else if ('lpub' in D) attempt(() => net.updateList(me, +D.lpub, { public: !net.list(me, +D.lpub, me).public }));
  else if ('lren' in D) attempt(() => net.updateList(me, +D.lren, { name: v('#l-ren') }));
  else if ('ldel' in D) { if (confirm('Supprimer cette liste ?')) attempt(async () => { await net.deleteList(me, +D.ldel); go('lists'); }); }
  else if ('ladd' in D) attempt(async () => { const n = (v('#l-add') || '').trim().replace(/^@/, ''); if (!n) throw new Error('Pseudo à ajouter ?'); const t = net.profile(n).name; if (!net.listsWith(me, t).includes(+D.ladd)) await net.toggleListMember(me, +D.ladd, t); });
  else if ('lshare' in D) { const [i, m] = D.lshare.split(':'); attempt(() => net.updateList(me, +i, { share: m === 'off' ? false : m === 'renew' ? 'renew' : true })); }
  else if ('lcopy' in D) { const x = $('#l-link'); x.select(); (navigator.clipboard ? navigator.clipboard.writeText(x.value) : Promise.reject()).catch(() => document.execCommand('copy')); d.textContent = 'Copié ✔'; }
  else if ('lforget' in D) { const [o, i] = D.lforget.split(':'); attempt(() => net.forgetSharedList(me, o, +i)); }
  else if ('lmem' in D) { const [i, n] = D.lmem.split(':'); attempt(() => net.toggleListMember(me, +i, n)); }
  else if ('cmopen' in D) { err = ''; go('group', +D.cmopen); }
  else if ('cmtab' in D) { view.tab = D.cmtab; err = ''; fs.scope = null; render(); }
  else if ('cmnew' in D) attempt(async () => { const g = await net.createGroup(me, v('#g-name'), v('#g-desc'), v('#g-rules'), $('#g-pub').checked); go('group', g.id); });
  else if ('cmjoin' in D) attempt(async () => { await net.joinGroup(me, +D.cmjoin); fs.scope = null; });
  else if ('cmleave' in D) attempt(async () => { await net.leaveGroup(me, +D.cmleave); fs.scope = null; });
  else if ('cmreq' in D) { const [i, n, a] = D.cmreq.split(':'); attempt(() => net.handleRequest(me, +i, n, a === '1')); }
  else if ('cminv' in D) attempt(async () => { const n = (v('#g-inv') || '').trim().replace(/^@/, ''); if (!n) throw new Error('Pseudo à inviter ?'); await net.inviteToGroup(me, +D.cminv, net.profile(n).name); const x = $('#g-inv'); if (x) x.value = ''; });
  else if ('cmrespond' in D) { const [i, a] = D.cmrespond.split(':'); attempt(async () => { await net.respondInvite(me, +i, a === '1'); fs.scope = null; }); }
  else if ('cmcancel' in D) { const [i, n] = D.cmcancel.split(':'); attempt(() => net.cancelInvite(me, +i, n)); }
  else if ('cmrm' in D) { const [i, n, b] = D.cmrm.split(':'); if (confirm(b === '1' ? `Bannir @${n} de la communauté ?` : `Retirer @${n} de la communauté ?`)) attempt(() => net.removeFromGroup(me, +i, n, b === '1')); }
  else if ('cmunban' in D) { const [i, n] = D.cmunban.split(':'); attempt(() => net.unbanFromGroup(me, +i, n)); }
  else if ('cmmod' in D) { const [i, n, o] = D.cmmod.split(':'); attempt(() => net.setGroupMod(me, +i, n, o === '1')); }
  else if ('cmsave' in D) attempt(async () => { const id = +D.cmsave, g = net.group(id), o = { desc: v('#g-edesc'), rules: v('#g-erules') }; if (net.groupRole(me, id) === 'owner') { o.name = v('#g-ename'); o.public = $('#g-epub').checked; } await net.updateGroup(me, id, o); notice = 'Communauté enregistrée ✔'; });
  else if ('cmdel' in D) { if (confirm('Supprimer cette communauté et tous ses posts ?')) attempt(async () => { await net.deleteGroup(me, +D.cmdel); go('groups'); }); }
  else if ('cmsend' in D) attempt(async () => {
    let poll = null; if (pollDraft.on) { pollRead(); poll = { options: pollDraft.opts, minutes: pollDraft.minutes }; }
    await net.post(me, v('#txt'), null, pend.post, poll, +D.cmsend); pend.post = []; if (poll) pollReset(); feedLoad(true);
  });
  else if ('tr' in D) translatePost(+D.tr);
  else if ('trclose' in D) { delete trans[+D.trclose]; render(); }
  else if ('user' in D) go('profile', D.user);
  else if ('sfollow' in D) attempt(async () => { await net.toggleFollow(me, D.sfollow); if (feedScope()) feedLoad(true); });
  else if ('sdismiss' in D) attempt(() => net.dismissSuggestion(me, D.sdismiss));
  else if ('follow' in D) attempt(() => net.toggleFollow(me, D.follow));
  else if ('chat' in D) go('dm', D.chat);
  else if ('dmdel' in D) { view.askDelDm = true; render(); }
  else if ('dmdelno' in D) { view.askDelDm = false; render(); }
  else if ('dmdelyes' in D) attempt(async () => { await net.deleteConversation(me, view.arg); view.askDelDm = false; });
  else if ('dm' in D) attempt(async () => { await net.send(me, view.arg, v('#dm'), pend.dm); pend.dm = []; });
  else if ('tag' in D) go('tag', D.tag);
  else if ('trange' in D) { trendRange = D.trange === '7d' ? '7d' : '24h'; render(); }
  else if ('topic' in D) attempt(() => net.toggleTopic(me, D.topic));
  else if ('search' in D) go('search', D.search);
  else if ('dosearch' in D) go('search', v('#q'));
  else if ('sfapply' in D) {
    const o = net.parseSearch(v('#q')), from = v('#sf-from').trim().replace(/^@/, ''), since = v('#sf-since'), until = v('#sf-until');
    go('search', [o.text, from && 'de:@' + from, since && 'depuis:' + since, until && 'avant:' + until, $('#sf-img').checked && 'avec:image', $('#sf-poll').checked && 'avec:sondage', $('#sf-sort').value === 'popular' && 'tri:populaire'].filter(Boolean).join(' '));
  }
  else if ('sssave' in D) attempt(async () => { const o = net.parseSearch(view.arg); await net.saveSearch(me, view.arg, o.sort, v('#ss-name')); });
  else if ('ssdel' in D) attempt(() => net.deleteSearch(me, +D.ssdel));
  else if ('ssopen' in D) { const s = net.searches(me).find(x => x.id === +D.ssopen); if (s) { go('search', s.q + (s.sort === 'popular' && !/tri:/i.test(s.q) ? ' tri:populaire' : '')); net.markSearchSeen(me, s.id).catch(() => {}); } }
});
// choix des fichiers : import, redimensionnement, ajout à l'aperçu (4 max)
document.addEventListener('change', async ev => {
  const t = ev.target; if (!t.dataset || !t.dataset.pick) return;
  const key = t.dataset.pick, files = [...t.files]; err = '';
  for (const f of files) {
    if (pend[key].length >= MAX_IMG) { err = `${MAX_IMG} images maximum`; break; }
    try { pend[key].push(await prepImage(f)); } catch (e) { err = e.message; }
  }
  refresh();
});
// texte alternatif : mémorisé à la frappe
document.addEventListener('input', ev => { const d = ev.target.dataset; if (d && d.alt) { const [k, i] = d.alt.split(':'); if (pend[k][+i]) pend[k][+i].alt = ev.target.value; } });
// plein écran : Échap ferme, flèches naviguent, Tab reste dans la visionneuse
document.addEventListener('keydown', ev => {
  if (!lb) return;
  if (ev.key === 'Escape') closeLb();
  else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { lb.i = (lb.i + (ev.key === 'ArrowRight' ? 1 : -1) + lb.images.length) % lb.images.length; lightbox(); }
  else if (ev.key === 'Tab') { const b = [...document.querySelectorAll('#lb button')], i = b.indexOf(document.activeElement); ev.preventDefault(); b[(i + (ev.shiftKey ? -1 : 1) + b.length) % b.length].focus(); }
});
render();
// démarrage : première synchro avec le serveur, puis interrogation régulière (les changements des autres appareils arrivent seuls)
(async () => {
  try { await sync.pull(true); } catch (e) { err = e.message; }
  if (LINK && LINK.kind === 'verify') { try { const r = await net.verifyEmail(LINK.token); linkMsg = `Adresse ${r.email} vérifiée pour @${r.name} ✔`; } catch (e) { linkMsg = e.message; } }
  booting = false; checkSession();
  if (me && Notif.supported() && Notif.seenGet(store, me) === null) Notif.seenSet(store, me, net.notifications(me).reduce((m, n) => Math.max(m, n.id), 0));
  if (new URLSearchParams(location.search).get('notif') && me) view = { page: 'notifs' };
  if (SHARED && me) { const s = SHARED; SHARED = null; await attempt(async () => { const r = await net.saveSharedList(me, s.owner, s.id, s.token); view = { page: 'list', arg: { owner: r.owner, id: r.id } }; }); }
  if (linkMsg && me) { /✔/.test(linkMsg) ? view = { page: 'security', ok: linkMsg } : err = linkMsg; linkMsg = ''; LINK = null; }
  if (STREAM) await attempt(async () => { if (me !== 'Streamer') openSession(await net.ensureStreamer()); view = { page: 'admin' }; }); else render();
  // temps réel : le serveur annonce chaque changement (SSE) ; l'interrogation ne sert plus que de secours
  setInterval(() => { if (!sync.connected()) sync.poll().then(feedFresh); }, 2000);
  setInterval(() => { if (sync.connected()) sync.poll().then(feedFresh); }, 20000);
  window.addEventListener('focus', () => { sync.poll().then(feedFresh); if (view.page === 'dm') refresh(); });
})();
// la page Tendances se rafraîchit seule (le score dépend de l'heure)
setInterval(() => { if (me && view.page === 'trends') refresh(); }, 3000);

// ---- autocomplétion des mentions : taper @ dans un champ de texte propose les membres ----
(() => {
  let box = null, ta = null, items = [], sel = 0, from = 0;
  const close = () => { if (box) box.remove(); box = null; ta = null; items = []; };
  const eligible = x => x && x.tagName === 'TEXTAREA' && !x.classList.contains('json') && x.closest('#app') && me;
  const draw = () => {
    if (!items.length) return close();
    if (!box) { box = document.createElement('div'); box.className = 'mentionbox card'; box.setAttribute('role', 'listbox'); box.setAttribute('aria-label', 'Mentionner un membre'); document.body.appendChild(box); }
    const r = ta.getBoundingClientRect();
    box.style.left = Math.max(4, r.left + scrollX) + 'px'; box.style.top = (r.bottom + scrollY + 2) + 'px'; box.style.minWidth = Math.min(r.width, 280) + 'px';
    box.innerHTML = items.map((u, i) => `<div role="option" class="mopt${i === sel ? ' on' : ''}" aria-selected="${i === sel}" data-mi="${i}">${av(u.name)}<b>${esc(u.display || u.name)}</b> <span class="mut">@${esc(u.name)}</span></div>`).join('');
  };
  const pick = i => {
    const u = items[i]; if (!u || !ta) return;
    const el = ta, end = el.selectionStart, ins = '@' + u.name + ' ';
    el.value = el.value.slice(0, from) + ins + el.value.slice(end);
    el.setSelectionRange(from + ins.length, from + ins.length); close(); el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.addEventListener('input', ev => {
    const x = ev.target; if (!eligible(x)) return close();
    const pos = x.selectionStart, m = /(^|[\s(])@(\w{0,30})$/.exec(x.value.slice(0, pos));
    if (!m) return close();
    try { items = net.mentionable(m[2], me, 5); } catch (e) { items = []; }
    ta = x; from = pos - m[2].length - 1; sel = 0; draw();
  });
  document.addEventListener('keydown', ev => {
    if (!box || !items.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); sel = (sel + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; draw(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); ev.stopImmediatePropagation(); pick(sel); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  }, true);
  document.addEventListener('mousedown', ev => { const o = ev.target.closest && ev.target.closest('.mopt'); if (o) { ev.preventDefault(); pick(+o.dataset.mi); } else if (box && ev.target !== ta) close(); });
  document.addEventListener('focusout', ev => { if (ev.target === ta) setTimeout(() => { if (document.activeElement !== ta) close(); }, 150); });
})();
