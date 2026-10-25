// Vraie application partagée : les données (clé de stockage historique twitchgram.v1, conservée pour ne pas perdre les données) sont communes à tous les visiteurs et au stream ;
// seule la session (app.session) reste propre à chaque visiteur. Vue stream (?stream=1) : session du vrai compte « Streamer ».
const STREAM = new URLSearchParams(location.search).get('stream') === '1';
const SESSION = 'app.session', A11Y_KEY = A11y.KEY;
const store = localStorage;
const net = Social.Net(store);
const sysDark = matchMedia('(prefers-color-scheme: dark)');
let prefs = A11y.load(store);
const applyPrefs = () => A11y.apply(prefs, document, sysDark.matches);
sysDark.addEventListener && sysDark.addEventListener('change', applyPrefs);
applyPrefs();
let th = Theme.load(store);
const applyTheme = () => Theme.apply(th, document);
applyTheme();
let notice = '';
// session : « pseudo|époque » (époque changée = « déconnecté partout »)
let me = null;
const checkSession = () => {
  const [n, ep] = (store.getItem(SESSION) || '').split('|');
  try { net.profile(n); if (+(ep || 0) !== net.epoch(n)) throw 0; me = net.profile(n).name; } catch (e) { me = null; store.removeItem(SESSION); }
};
checkSession();
let view = { page: 'feed' };
const $ = s => document.querySelector(s);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rich = s => esc(s).replace(/#\w+/g, t => `<span class="tag" data-search="${t}">${t}</span>`).replace(/@\w+/g, t => `<span class="mention" data-user="${t.slice(1)}">${t}</span>`);
const color = n => `hsl(${[...n].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360},60%,45%)`;
const prof = n => { try { return net.profile(n); } catch (e) { return {}; } };
const shown = n => prof(n).display || n;
const av = (n, big) => `<span class="av${big ? ' big' : ''}" style="background:${prof(n).avatar || color(n)}">${esc(shown(n)[0].toUpperCase())}</span>`;
const GRADS = ['linear-gradient(135deg,#9146ff,#ff4d8d)', 'linear-gradient(135deg,#00c6ff,#0072ff)', 'linear-gradient(135deg,#f7971e,#ffd200)', 'linear-gradient(135deg,#11998e,#38ef7d)', 'linear-gradient(135deg,#232526,#9146ff)', 'linear-gradient(135deg,#ff512f,#dd2476)'];
const bannerCss = b => !b ? GRADS[0] : b.startsWith('grad:') ? GRADS[+b.slice(5)] : `center/cover url("${encodeURI(b).replace(/"/g, '%22')}"), ${GRADS[4]}`;
const peopleList = names => names.map(n => `<div class="card person" data-user="${esc(n)}">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)} · ${esc(prof(n).bio || '')}</span></div>`).join('') || '<p class="mut">Personne pour l’instant.</p>';
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' j'; };
const go = (page, arg) => { view = { page, arg }; pend.post = []; pend.dm = []; render(); };
let err = '';
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
window.addEventListener('storage', ev => { if (ev.key === Theme.KEY) { th = Theme.load(store); applyTheme(); if (view.page === 'theme' && me) refresh(); }
  if (ev.key === A11Y_KEY) { prefs = A11y.load(store); applyPrefs(); } if (ev.key === null || ev.key === Social.KEY) refresh(); });
const openSession = name => { me = name; store.setItem(SESSION, me + '|' + net.epoch(me)); };

function postHTML(p, thread) {
  const liked = me && p.likes.includes(me), n = net.replies(p.id, me).length, editing = view.editing === p.id && net.canEdit(me, p.id);
  const saved = net.isBookmarked(me, p.id), rp = net.hasReposted(me, p.id), rc = net.repostCount(p.id), hist = p.history || [];
  const edited = p.editedAt ? `<button class="lnk" data-hist="${p.id}" aria-expanded="${view.hist === p.id}">modifié</button>` : '';
  const histHTML = p.editedAt && view.hist === p.id ? `<div class="hist"><b>Historique des modifications</b>${hist.map(h => `<div class="mut">${ago(h.at)} · ${esc(h.text)}</div>`).join('')}<div>Actuel · ${esc(p.text)}</div></div>` : '';
  const body = editing ? `<textarea id="edit-txt" maxlength="280">${esc(p.text)}</textarea><button data-saveedit="${p.id}">💾 Enregistrer</button> <button data-canceledit>Annuler</button> <span class="mut">${Math.ceil(net.editLeft(p.id) / 60000)} min restantes</span>` : `${p.text ? `<p>${rich(p.text)}</p>` : ''}${gallery(p.images, 'p', p.id)}`;
  return `<div class="card post">${av(p.author)}<span class="who" data-user="${p.author}">${esc(shown(p.author))}</span> <span class="mut">@${esc(p.author)} · ${ago(p.at)}</span> ${edited}
  ${body}${histHTML}${view.reporting === p.id ? reportForm(p.id) : ''}<div class="acts"><button data-like="${p.id}" class="${liked ? 'on' : ''}">♥ ${p.likes.length}</button>
  <button data-open="${p.id}">💬 ${n}</button>${!p.replyTo && p.author !== me ? `<button data-repost="${p.id}" class="${rp ? 'on' : ''}" aria-pressed="${rp}" aria-label="${rp ? 'Annuler le repartage' : 'Repartager sur mon profil'}">🔁 ${rc}</button>` : rc ? `<span class="mut">🔁 ${rc}</span>` : ''}
  ${p.author !== me && !net.isAdmin(p.author) ? `<button data-report="${p.id}" class="${net.hasReported(me, p.id) ? 'on' : ''}" aria-label="${net.hasReported(me, p.id) ? 'Post déjà signalé' : 'Signaler le post'}" ${net.hasReported(me, p.id) ? 'disabled' : ''}>🚩</button>` : ''}<button data-bm="${p.id}" class="${saved ? 'on' : ''}" aria-pressed="${saved}" aria-label="${saved ? 'Retirer des favoris' : 'Mettre en favori'}">${saved ? '🔖' : '📑'}</button>${net.canEdit(me, p.id) && !editing ? `<button data-edit="${p.id}" aria-label="Modifier le post">✏️</button>` : ''}${p.author === me || net.isAdmin(me) ? `<button data-del="${p.id}">🗑</button>` : ''}</div></div>`;
}
const reportForm = id => `<div class="card report" role="group" aria-label="Signaler ce post"><b>🚩 Signaler ce post</b>
  <label>Motif <select id="rp-reason">${Object.entries(net.reasons()).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
  <label>Précisions (facultatif)<textarea id="rp-note" maxlength="300"></textarea></label>
  <button data-sendreport="${id}">Envoyer le signalement</button> <button data-cancelreport>Annuler</button></div>`;
const SANC = { warn: '⚠️ Avertissement', suspend: '⏸ Suspension', ban: '⛔ Bannissement' };
const sancLabel = s => `${SANC[s.type]}${s.type === 'suspend' ? ` jusqu’à ${new Date(s.until).toLocaleString('fr-FR')}` : ''} · ${esc(s.reason || '')}`;
function modPage(e) {
  const q = net.queue(me), hist = net.history(me, 15), sl = net.sanctioned(me), R = net.reasons();
  return `<div class="card"><h2>🛡 File de modération</h2><p class="mut">${q.length} post${q.length > 1 ? 's' : ''} à examiner, les plus signalés d’abord.</p></div>${e}` +
  (q.map(g => `<div class="card mod"><b>@${esc(g.target)}</b> <span class="mut">· ${g.reports.length} signalement${g.reports.length > 1 ? 's' : ''}</span>
    <blockquote>${esc(g.snap.text) || '<span class="mut">(sans texte)</span>'}${g.snap.images ? ` <span class="mut">📷 ${g.snap.images}</span>` : ''}</blockquote>
    <ul>${g.reports.map(r => `<li><b>${esc(R[r.reason] || r.reason)}</b> · @${esc(r.by)} <span class="mut">${ago(r.at)}${r.note ? ' · ' + esc(r.note) : ''}</span></li>`).join('')}</ul>
    <label class="inl">Durée de suspension (h) <input id="mh-${g.postId}" type="number" min="1" max="2160" value="24"></label>
    <div class="row"><button data-open="${g.postId}">👁 Voir</button><button data-mod="${g.postId}:dismiss">✅ Classer sans suite</button><button data-mod="${g.postId}:delete">🗑 Supprimer le post</button><button data-mod="${g.postId}:warn">⚠️ Avertir</button><button data-mod="${g.postId}:suspend">⏸ Suspendre</button><button data-mod="${g.postId}:ban">⛔ Bannir</button></div></div>`).join('') || '<p class="mut">Aucun signalement en attente 🎉</p>') +
  `<div class="card"><b>Comptes sanctionnés</b>${sl.map(x => `<div class="row"><span>@${esc(x.name)} · ${sancLabel(x.sanction)}</span><button data-lift="${esc(x.name)}">Lever</button></div>`).join('') || '<p class="mut">Aucun.</p>'}</div>
  <div class="card"><b>Historique</b>${hist.map(r => `<div class="mut">#${r.postId} @${esc(r.target)} · ${esc(R[r.reason] || r.reason)} → ${({ dismiss: 'sans suite', delete: 'post supprimé', warn: 'avertissement', suspend: 'suspension', ban: 'bannissement' })[r.action]} (${ago(r.closedAt)})</div>`).join('') || '<p class="mut">Vide.</p>'}</div>`;
}
const composer = (ph, reply) => `<div class="card"><textarea id="txt" maxlength="280" placeholder="${ph}"></textarea>${attachBox('post')}<button data-send="${reply || ''}">Publier</button></div>`;

function render() {
  const nav = $('#nav'), app = $('#app');
  $('#me').innerHTML = me ? `${STREAM ? '<b>🔴 STREAM</b> ' : ''}@${esc(me)}${net.isAdmin(me) ? ' 👑 admin' : ''} <button data-logout>Quitter</button>` : '';
  if (!me) {
    nav.innerHTML = '';
    app.innerHTML = `<div class="card"><h2>Bienvenue dans le bocal Cornichon</h2><input id="u" placeholder="Pseudo"><input id="pw" type="password" placeholder="Mot de passe"><input id="bio" placeholder="Bio (inscription)">
    <button data-login>Connexion</button> <button data-signup>Créer un compte</button><p class="err">${esc(err)}</p></div>`;
    return;
  }
  const unread = net.notifications(me).filter(n => !n.read).length;
  nav.innerHTML = [['feed', '🏠 Mon fil'], ['explore', '🌍 Explorer'], ['trends', '🔥 Tendances'], ['search', '🔎 Recherche'], ['notifs', `🔔 ${unread || ''}`], ['bookmarks', '🔖 Favoris'], ['dm', '✉️ Messages'], ['profile', '👤 Profil'], ['theme', '🎨 Thème'], ['settings', '⚙️ Réglages'], ['blocks', '🚫 Bloqués'], ['security', '🔒 Sécurité']].concat(net.isAdmin(me) ? [['mod', `🛡 Modération ${net.queue(me).length || ''}`]] : [])
    .map(([k, l]) => `<button data-page="${k}" class="${view.page === k ? 'on' : ''}">${l}</button>`).join('');
  const e = err ? `<p class="err">${esc(err)}</p>` : '';
  const mySanc = net.sanctionOf(me);
  const list = ps => ps.map(p => postHTML(p)).join('') || '<p class="mut">Rien ici pour l’instant.</p>';
  let h = '';
  if (view.page === 'feed') h = composer('Quoi de neuf ?') + e + list(net.feed(me));
  else if (view.page === 'explore') {
    h = composer('Quoi de neuf ?') + e + `<div class="card"><b>Tendances</b> ${net.trending().map(([t, c]) => `<span class="tag" data-search="${t}">${t} (${c})</span>`).join(' ') || '<span class="mut">aucune</span>'}</div>` + list(net.explore(me));
  } else if (view.page === 'trends') {
    const medal = i => ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
    h = `<div class="card"><b>🔴 En direct · hashtags du moment</b><ol class="trend">${net.trendingLive().map(t => `<li><span class="tag" data-search="${t.tag}">${t.tag}</span> <span class="mut">${t.count} post${t.count > 1 ? 's' : ''}</span><i class="bar" style="width:${Math.max(6, Math.round(t.score / (net.trendingLive(1)[0].score || 1) * 100))}%"></i></li>`).join('') || '<li class="mut">aucun hashtag</li>'}</ol></div>
    <div class="card"><b>🏆 Classement des posts</b></div>` + net.ranking(6, me).map((r, i) => `<div class="rank"><span class="medal">${medal(i)}</span>${postHTML(r.post)}<span class="mut">score ${r.score.toFixed(1)}</span></div>`).join('') + (e || '');
  } else if (view.page === 'bookmarks') {
    h = `<div class="card"><h2>🔖 Mes favoris</h2><p class="mut">Les posts que tu as mis de côté (visibles par toi seul).</p></div>${e}` + list(net.bookmarks(me));
  } else if (view.page === 'search') {
    const r = net.search(view.arg, me);
    h = `<div class="card"><input id="q" placeholder="Pseudo, mot, #tag" value="${esc(view.arg || '')}"><button data-dosearch>Chercher</button></div>` +
      r.users.map(u => `<div class="card">${av(u.name)}<span class="who" data-user="${u.name}">${esc(shown(u.name))}</span> <span class="mut">${esc(u.bio)}</span></div>`).join('') + list(r.posts);
  } else if (view.page === 'notifs') {
    const L = { sanction: 'a pris une mesure de modération contre votre compte', like: 'a aimé votre post', reply: 'a répondu à votre post', mention: 'vous a mentionné', follow: 'vous suit', repost: 'a repartagé votre post' };
    h = net.notifications(me, true).map(n => `<div class="card" ${n.postId ? `data-open="${n.postId}"` : `data-user="${n.from}"`}><b>${esc(n.from)}</b> ${L[n.type]} <span class="mut">· ${ago(n.at)}</span></div>`).join('') || '<p class="mut">Aucune notification.</p>';
  } else if (view.page === 'thread') {
    const p = net.db().posts.find(x => x.id === view.arg);
    h = p ? postHTML(p) + composer('Votre réponse…', p.id) + e + net.replies(p.id, me).map(r => postHTML(r)).join('') : '<p class="mut">Post supprimé.</p>';
  } else if (view.page === 'profile') {
    const name = view.arg || me, u = net.profile(name), fl = net.followers(name), self = u.name === me;
    h = `<div class="card prof"><div class="banner" style="background:${bannerCss(u.banner)}"></div><div class="pbody">${av(u.name, true)}<b class="pname">${esc(u.display || u.name)}</b> <span class="mut">@${esc(u.name)}</span>
      <p>${esc(u.bio) || '<span class="mut">Pas de bio</span>'}</p>${u.link ? `<p><a href="${esc(u.link)}" target="_blank" rel="noopener noreferrer nofollow">🔗 ${esc(u.link.replace(/^https?:\/\//, ''))}</a></p>` : ''}
      <p class="stats"><button data-sub="followers:${u.name}" class="${view.sub === 'followers' ? 'on' : ''}"><b>${fl.length}</b> abonnés</button> <button data-sub="following:${u.name}" class="${view.sub === 'following' ? 'on' : ''}"><b>${u.following.length}</b> abonnements</button></p>` +
      (self ? `<button data-page="settings">⚙️ Modifier le profil</button>` : `<button data-follow="${u.name}">${fl.includes(me) ? 'Se désabonner' : 'Suivre'}</button> <button data-chat="${u.name}">Message</button>` + (u.admin ? '' : ` <button data-mute="${u.name}" aria-pressed="${net.isMuted(me, u.name)}">${net.isMuted(me, u.name) ? '🔊 Ne plus masquer' : '🔇 Masquer'}</button> <button data-block="${u.name}" aria-pressed="${net.isBlocked(me, u.name)}">${net.isBlocked(me, u.name) ? '✅ Débloquer' : '🚫 Bloquer'}</button>`)) + (net.sanctionOf(u.name) && net.isAdmin(me) ? ` <span class="err">${sancLabel(net.sanctionOf(u.name))}</span>` : '') + `</div></div>${e}` +
      (view.sub ? `<div class="card"><b>${view.sub === 'followers' ? 'Abonnés' : 'Abonnements'}</b> <button data-sub="">✕</button></div>` + peopleList(view.sub === 'followers' ? fl : u.following) : (net.timeline(name, me).map(t => (t.by ? `<p class="mut rt">🔁 ${esc(shown(t.by))} a repartagé</p>` : '') + postHTML(t.post)).join('') || '<p class="mut">Rien ici pour l’instant.</p>'));
  } else if (view.page === 'mod' && net.isAdmin(me)) {
    h = modPage(e);
  } else if (view.page === 'blocks') {
    const row = (n, kind) => `<div class="card person">${av(n)}<b>${esc(shown(n))}</b> <span class="mut">@${esc(n)}</span> <button data-${kind}="${esc(n)}">${kind === 'unblock' ? 'Débloquer' : 'Ne plus masquer'}</button></div>`;
    h = `<div class="card"><h2>🚫 Comptes bloqués et masqués</h2><p class="mut">Leurs posts, réponses et messages disparaissent de ton fil. Bloquer coupe aussi les abonnements et les empêche de te répondre, te suivre ou t’écrire ; masquer reste discret.</p></div>${e}
      <div class="card"><b>Bloqués</b></div>${net.blockedList(me).map(n => row(n, 'unblock')).join('') || '<p class="mut">Aucun compte bloqué.</p>'}
      <div class="card"><b>Masqués</b></div>${net.mutedList(me).map(n => row(n, 'unmute')).join('') || '<p class="mut">Aucun compte masqué.</p>'}`;
  } else if (view.page === 'theme') {
    h = themePage();
  } else if (view.page === 'settings') {
    const u = net.profile(me), b = u.banner || '';
    h = `<div class="card"><h2>⚙️ Réglages du profil</h2><div class="banner" id="pvb" style="background:${bannerCss(b)}"></div>
      <label>Pseudo affiché<input id="s-display" maxlength="30" value="${esc(u.display || '')}" placeholder="${esc(u.name)}"></label>
      <label>Bio<textarea id="s-bio" maxlength="160">${esc(u.bio)}</textarea></label>
      <label>Couleur d’avatar<input id="s-avatar" type="color" value="${u.avatar || '#9146ff'}"></label>
      <label>Image de bannière (URL) <input id="s-banner" value="${esc(/^grad:/.test(b) ? '' : b)}" placeholder="https://…/image.jpg"></label>
      <div class="grads">${GRADS.map((g, i) => `<button data-grad="${i}" style="background:${g}" title="Dégradé ${i + 1}"></button>`).join('')}</div>
      <label>Lien web<input id="s-link" value="${esc(u.link || '')}" placeholder="https://twitch.tv/…"></label>
      <input id="s-gradv" type="hidden" value="${/^grad:/.test(b) ? b : ''}">
      <button data-saveprofile>💾 Enregistrer</button> <button data-page="security">🔒 Sécurité</button> <button data-user="${u.name}">Voir mon profil</button>${e}</div>
      <div class="card" role="group" aria-labelledby="h-look"><h2 id="h-look">🎨 Apparence et accessibilité</h2>
      <b id="l-theme">Thème</b><div class="row" role="group" aria-labelledby="l-theme">${[['auto', '🖥 Auto'], ['light', '☀️ Clair'], ['dark', '🌙 Sombre']].map(([k, l]) => `<button data-theme="${k}" aria-pressed="${prefs.theme === k}" class="${prefs.theme === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <b id="l-size">Taille du texte : ${prefs.size} %</b><div class="row" role="group" aria-labelledby="l-size"><button data-size="-1" aria-label="Réduire le texte" ${prefs.size === A11y.SIZES[0] ? 'disabled' : ''}>A−</button><button data-size="0" aria-label="Taille normale">A</button><button data-size="1" aria-label="Agrandir le texte" ${prefs.size === A11y.SIZES[A11y.SIZES.length - 1] ? 'disabled' : ''}>A+</button></div>
      <p class="mut">Navigation au clavier : Tab / Maj+Tab, Entrée ou Espace pour activer. Ces préférences restent sur cet appareil.</p></div>
      <div class="card" role="group" aria-labelledby="h-data"><h2 id="h-data">📦 Mes données</h2><p class="mut">Exporte ton profil, tes posts et tes messages en JSON (sans mot de passe), ou importe un export pour les fusionner dans ton compte.</p>
      <div class="row"><button data-export>⬇️ Exporter en JSON</button><label class="mut">Importer un fichier <input id="imp-file" type="file" accept="application/json,.json"></label></div>
      <label for="imp-txt">Ou colle le JSON ici</label><textarea id="imp-txt" class="json" placeholder='{"format":"cornichon-export",…}'></textarea><button data-import>⬆️ Importer</button>
      <p class="ok" role="status">${esc(notice)}</p></div>`;
  } else if (view.page === 'security') {
    h = `<div class="card"><h2>🔒 Sécurité</h2><b>Changer le mot de passe</b>
      <input id="sec-old" type="password" placeholder="Mot de passe actuel" autocomplete="current-password"><input id="sec-new" type="password" placeholder="Nouveau mot de passe (4 min)" autocomplete="new-password"><input id="sec-new2" type="password" placeholder="Confirmer le nouveau mot de passe" autocomplete="new-password">
      <button data-chpw>Changer le mot de passe</button> <p class="mut">Les autres appareils seront déconnectés. Après 5 connexions ratées, le pseudo est bloqué 60 s.</p></div>
      <div class="card"><b>Se déconnecter partout</b><p class="mut">Ferme toutes les sessions ouvertes, y compris celle-ci.</p><button data-logoutall>🚪 Déconnecter tous mes appareils</button></div>
      <div class="card"><b>Supprimer mon compte</b><p class="mut">Supprime définitivement le compte, ses posts, réponses, likes et messages.</p>
      ${net.isAdmin(me) ? '<p class="mut">Le compte Streamer ne peut pas être supprimé.</p>' : '<input id="sec-del" type="password" placeholder="Mot de passe pour confirmer"><button data-delacc>🗑 Supprimer mon compte et mes posts</button>'}</div>${e}${view.ok ? `<p class="ok">${esc(view.ok)}</p>` : ''}`;
  } else if (view.page === 'dm') {
    const peers = Object.values(net.db().users).filter(u => u.name !== me && !net.isHidden(me, u.name));
    h = `<div class="card">${peers.map(u => `<button data-chat="${u.name}" class="${view.arg === u.name ? 'on' : ''}">${esc(u.name)}</button>`).join(' ') || '<span class="mut">Personne d’autre pour l’instant.</span>'}</div>`;
    if (view.arg) h += `<div class="card" style="display:grid;gap:6px">${net.conversation(me, view.arg).map(m => `<div class="msg ${m.from === me ? 'me' : ''}">${m.text ? esc(m.text) : ''}${gallery(m.images, 'm', m.id)}</div>`).join('') || '<span class="mut">Dites bonjour 👋</span>'}
      <input id="dm" placeholder="Message à ${esc(view.arg)}">${attachBox('dm')}<button data-dm>Envoyer</button></div>${e}`;
  }
  app.innerHTML = (mySanc ? `<div class="card err" role="alert">Mesure de modération : ${sancLabel(mySanc)}</div>` : '') + h;
  a11yPass();
}
// accessibilité : éléments cliquables non-boutons focalisables, états ARIA, libellés
function a11yPass() {
  document.querySelectorAll('#app [data-user]:not(button),#app [data-search]:not(button),#app [data-open]:not(button)').forEach(x => { x.tabIndex = 0; x.setAttribute('role', 'button'); });
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
  const t = ev.target, path = t.dataset && t.dataset.tf; if (!path || t.tagName === 'SELECT') return;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  editTheme(x => { if (path === 'on') { x.on = val; x._keepOff = !val; } else setPath(x, path, val); });
  const o = document.getElementById('o-' + path.replace(/\.stops\./, '-').replace(/\.[cp]$/, '').replace(/^(\w+)\.angle$/, '$1-angle'));
  if (o && t.type === 'range') o.textContent = val + (/angle/.test(path) ? '°' : /radius/.test(path) ? 'px' : '%');
  if (t.type === 'checkbox') render(); else livePreview();
});
document.addEventListener('change', ev => {
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

document.addEventListener('click', ev => {
  const d = ev.target.closest('*[data-page],*[data-like],*[data-open],*[data-del],*[data-send],*[data-user],*[data-search],*[data-login],*[data-signup],*[data-logout],*[data-follow],*[data-chat],*[data-dm],*[data-dosearch],*[data-sub],*[data-grad],*[data-saveprofile],*[data-chpw],*[data-logoutall],*[data-delacc],*[data-theme],*[data-size],*[data-export],*[data-import],*[data-bm],*[data-repost],*[data-edit],*[data-saveedit],*[data-canceledit],*[data-hist],*[data-gal],*[data-rmimg],*[data-lbclose],*[data-lbnav],*[data-tpreset],*[data-tadd],*[data-trm],*[data-trev],*[data-trandom],*[data-treset],*[data-texport],*[data-timport],*[data-report],*[data-sendreport],*[data-cancelreport],*[data-block],*[data-mute],*[data-unblock],*[data-unmute],*[data-mod],*[data-lift]');
  if (!d || d === document.documentElement || d === document.body) return;   // <html data-theme> ne doit pas déclencher d'action (sinon chaque clic re-rendait la page et effaçait le focus des champs)
  const D = d.dataset, v = id => ($(id) || {}).value;
  if (Object.keys(D).some(k => /^t(preset|add|rm|rev|random|reset|export|import)$/.test(k))) themeClick(D, v);
  else if ('login' in D) attempt(async () => openSession(await net.login(v('#u'), v('#pw'))));
  else if ('signup' in D) attempt(async () => openSession(await net.signup(v('#u'), v('#pw'), v('#bio'))));
  else if ('logout' in D) { me = null; store.removeItem(SESSION); if (STREAM) attempt(async () => openSession(await net.ensureStreamer())); go('feed'); }
  else if ('chpw' in D) attempt(async () => {
    if (v('#sec-new') !== v('#sec-new2')) throw new Error('La confirmation ne correspond pas');
    await net.changePassword(me, v('#sec-old'), v('#sec-new')); openSession(me); view = { page: 'security', ok: 'Mot de passe modifié ✔ (autres appareils déconnectés)' };
  });
  else if ('logoutall' in D) { net.logoutAll(me); me = null; store.removeItem(SESSION); err = ''; go('feed'); }
  else if ('delacc' in D) attempt(async () => {
    if (!confirm('Supprimer définitivement votre compte et tous vos posts ?')) return;
    await net.deleteAccount(me, v('#sec-del')); me = null; store.removeItem(SESSION); view = { page: 'feed' };
  });
  else if ('theme' in D) { prefs = A11y.save(store, { theme: D.theme }); applyPrefs(); render(); }
  else if ('size' in D) { const i = A11y.SIZES.indexOf(prefs.size), j = D.size === '0' ? A11y.SIZES.indexOf(100) : Math.max(0, Math.min(A11y.SIZES.length - 1, i + +D.size)); prefs = A11y.save(store, { size: A11y.SIZES[j] }); applyPrefs(); render(); }
  else if ('export' in D) { download(`cornichon-${me}.json`, JSON.stringify(net.exportUser(me), null, 2)); notice = 'Export téléchargé ✔'; render(); }
  else if ('import' in D) attempt(async () => {
    const f = ($('#imp-file') || {}).files && $('#imp-file').files[0], txt = f ? await f.text() : v('#imp-txt');
    const r = net.importUser(me, txt); notice = `Import réussi ✔ : ${r.posts} post(s), ${r.messages} message(s), ${r.following} abonnement(s)`;
  });
  else if ('gal' in D) {
    const [k, i, j] = D.gal.split(':'), it = k === 'p' ? net.db().posts.find(x => x.id === +i) : net.db().messages.find(x => x.id === +i);
    if (it && it.images) { lb = { images: it.images, i: +j, from: D.gal }; lightbox(); }
  }
  else if ('rmimg' in D) { const [k, i] = D.rmimg.split(':'); pend[k].splice(+i, 1); err = ''; refresh(); }
  else if ('lbclose' in D) closeLb();
  else if ('lbnav' in D) { lb.i = (lb.i + +D.lbnav + lb.images.length) % lb.images.length; lightbox(); }
  else if ('page' in D) { err = ''; notice = ''; go(D.page); $('#app').focus(); }
  else if ('send' in D) attempt(() => { net.post(me, v('#txt'), D.send ? +D.send : null, pend.post); pend.post = []; });
  else if ('like' in D) attempt(() => net.toggleLike(me, +D.like));
  else if ('bm' in D) attempt(() => net.toggleBookmark(me, +D.bm));
  else if ('repost' in D) attempt(() => net.toggleRepost(me, +D.repost));
  else if ('edit' in D) { view.editing = +D.edit; render(); const t = $('#edit-txt'); if (t) t.focus(); }
  else if ('canceledit' in D) { view.editing = null; render(); }
  else if ('saveedit' in D) attempt(() => { net.editPost(me, +D.saveedit, v('#edit-txt')); view.editing = null; });
  else if ('hist' in D) { view.hist = view.hist === +D.hist ? null : +D.hist; render(); }
  else if ('report' in D) { view.reporting = +D.report; err = ''; render(); const x = $('#rp-reason'); if (x) x.focus(); }
  else if ('cancelreport' in D) { view.reporting = null; render(); }
  else if ('sendreport' in D) attempt(() => { net.report(me, +D.sendreport, v('#rp-reason'), v('#rp-note')); view.reporting = null; notice = ''; });
  else if ('block' in D) attempt(() => net.toggleBlock(me, D.block));
  else if ('unblock' in D) attempt(() => net.toggleBlock(me, D.unblock));
  else if ('mute' in D) attempt(() => net.toggleMute(me, D.mute));
  else if ('unmute' in D) attempt(() => net.toggleMute(me, D.unmute));
  else if ('lift' in D) attempt(() => net.liftSanction(me, D.lift));
  else if ('mod' in D) attempt(() => { const [pid, act] = D.mod.split(':'); net.moderate(me, +pid, act, { hours: v('#mh-' + pid) }); });
  else if ('del' in D) attempt(() => net.deletePost(me, +D.del));
  else if ('open' in D) go('thread', +D.open);
  else if ('sub' in D) { const [k, n] = D.sub.split(':'); view = { page: 'profile', arg: n, sub: k || null }; render(); }
  else if ('grad' in D) { $('#s-gradv').value = 'grad:' + D.grad; $('#s-banner').value = ''; $('#pvb').style.background = GRADS[+D.grad]; }
  else if ('saveprofile' in D) attempt(() => { net.updateProfile(me, { display: v('#s-display'), bio: v('#s-bio'), avatar: v('#s-avatar'), banner: v('#s-banner') || v('#s-gradv'), link: v('#s-link') }); if (!err) view = { page: 'profile' }; });
  else if ('user' in D) go('profile', D.user);
  else if ('follow' in D) attempt(() => net.toggleFollow(me, D.follow));
  else if ('chat' in D) go('dm', D.chat);
  else if ('dm' in D) attempt(() => { net.send(me, view.arg, v('#dm'), pend.dm); pend.dm = []; });
  else if ('search' in D) go('search', D.search);
  else if ('dosearch' in D) go('search', v('#q'));
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
// « live » : la page Tendances se rafraîchit seule (les données viennent du stockage partagé)
setInterval(() => { if (me && view.page === 'trends') refresh(); }, 3000);
if (STREAM) attempt(async () => { openSession(await net.ensureStreamer()); view = { page: 'theme' }; });
