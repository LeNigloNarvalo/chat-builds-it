// Vraie application partagée : les données (twitchgram.v1) sont communes à tous les visiteurs et au stream ;
// seule la session (app.session) reste propre à chaque visiteur. Vue stream (?stream=1) : session du vrai compte « Streamer ».
const STREAM = new URLSearchParams(location.search).get('stream') === '1';
const SESSION = 'app.session';
const store = localStorage;
const net = Social.Net(store);
let me = store.getItem(SESSION);
if (me) { try { net.profile(me); } catch (e) { me = null; store.removeItem(SESSION); } }
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
const go = (page, arg) => { view = { page, arg }; render(); };
let err = '';
const attempt = async f => { try { err = ''; await f(); } catch (e) { err = e.message; } render(); };
// re-rendu sans perdre la saisie en cours (changement venu d'un autre visiteur)
function refresh() {
  if (me) { try { net.profile(me); } catch (e) { me = null; store.removeItem(SESSION); } }
  const a = document.activeElement, keep = [...document.querySelectorAll('#app input[id],#app textarea[id]')].map(x => [x.id, x.value]);
  render();
  for (const [id, val] of keep) { const x = document.getElementById(id); if (x && !x.value) x.value = val; }
  if (a && a.id && document.getElementById(a.id)) document.getElementById(a.id).focus();
}
window.addEventListener('storage', ev => { if (ev.key === null || ev.key === Social.KEY) refresh(); });
const openSession = name => { me = name; store.setItem(SESSION, me); };

function postHTML(p, thread) {
  const liked = me && p.likes.includes(me), n = net.replies(p.id).length;
  return `<div class="card post">${av(p.author)}<span class="who" data-user="${p.author}">${esc(shown(p.author))}</span> <span class="mut">@${esc(p.author)} · ${ago(p.at)}</span>
  <p>${rich(p.text)}</p><div class="acts"><button data-like="${p.id}" class="${liked ? 'on' : ''}">♥ ${p.likes.length}</button>
  <button data-open="${p.id}">💬 ${n}</button>${p.author === me || net.isAdmin(me) ? `<button data-del="${p.id}">🗑</button>` : ''}</div></div>`;
}
const composer = (ph, reply) => `<div class="card"><textarea id="txt" maxlength="280" placeholder="${ph}"></textarea><button data-send="${reply || ''}">Publier</button></div>`;

function render() {
  const nav = $('#nav'), app = $('#app');
  $('#me').innerHTML = me ? `${STREAM ? '<b>🔴 STREAM</b> ' : ''}@${esc(me)}${net.isAdmin(me) ? ' 👑 admin' : ''} <button data-logout>Quitter</button>` : '';
  if (!me) {
    nav.innerHTML = '';
    app.innerHTML = `<div class="card"><h2>Bienvenue sur TwitchGram</h2><input id="u" placeholder="Pseudo"><input id="pw" type="password" placeholder="Mot de passe"><input id="bio" placeholder="Bio (inscription)">
    <button data-login>Connexion</button> <button data-signup>Créer un compte</button><p class="err">${esc(err)}</p></div>`;
    return;
  }
  const unread = net.notifications(me).filter(n => !n.read).length;
  nav.innerHTML = [['feed', '🏠 Mon fil'], ['explore', '🌍 Explorer'], ['trends', '🔥 Tendances'], ['search', '🔎 Recherche'], ['notifs', `🔔 ${unread || ''}`], ['dm', '✉️ Messages'], ['profile', '👤 Profil'], ['settings', '⚙️ Réglages']]
    .map(([k, l]) => `<button data-page="${k}" class="${view.page === k ? 'on' : ''}">${l}</button>`).join('');
  const e = err ? `<p class="err">${esc(err)}</p>` : '';
  const list = ps => ps.map(p => postHTML(p)).join('') || '<p class="mut">Rien ici pour l’instant.</p>';
  let h = '';
  if (view.page === 'feed') h = composer('Quoi de neuf ?') + e + list(net.feed(me));
  else if (view.page === 'explore') {
    h = composer('Quoi de neuf ?') + e + `<div class="card"><b>Tendances</b> ${net.trending().map(([t, c]) => `<span class="tag" data-search="${t}">${t} (${c})</span>`).join(' ') || '<span class="mut">aucune</span>'}</div>` + list(net.explore());
  } else if (view.page === 'trends') {
    const medal = i => ['🥇', '🥈', '🥉'][i] || `#${i + 1}`;
    h = `<div class="card"><b>🔴 En direct · hashtags du moment</b><ol class="trend">${net.trendingLive().map(t => `<li><span class="tag" data-search="${t.tag}">${t.tag}</span> <span class="mut">${t.count} post${t.count > 1 ? 's' : ''}</span><i class="bar" style="width:${Math.max(6, Math.round(t.score / (net.trendingLive(1)[0].score || 1) * 100))}%"></i></li>`).join('') || '<li class="mut">aucun hashtag</li>'}</ol></div>
    <div class="card"><b>🏆 Classement des posts</b></div>` + net.ranking(6).map((r, i) => `<div class="rank"><span class="medal">${medal(i)}</span>${postHTML(r.post)}<span class="mut">score ${r.score.toFixed(1)}</span></div>`).join('') + (e || '');
  } else if (view.page === 'search') {
    const r = net.search(view.arg);
    h = `<div class="card"><input id="q" placeholder="Pseudo, mot, #tag" value="${esc(view.arg || '')}"><button data-dosearch>Chercher</button></div>` +
      r.users.map(u => `<div class="card">${av(u.name)}<span class="who" data-user="${u.name}">${esc(shown(u.name))}</span> <span class="mut">${esc(u.bio)}</span></div>`).join('') + list(r.posts);
  } else if (view.page === 'notifs') {
    const L = { like: 'a aimé votre post', reply: 'a répondu à votre post', mention: 'vous a mentionné', follow: 'vous suit' };
    h = net.notifications(me, true).map(n => `<div class="card" ${n.postId ? `data-open="${n.postId}"` : `data-user="${n.from}"`}><b>${esc(n.from)}</b> ${L[n.type]} <span class="mut">· ${ago(n.at)}</span></div>`).join('') || '<p class="mut">Aucune notification.</p>';
  } else if (view.page === 'thread') {
    const p = net.db().posts.find(x => x.id === view.arg);
    h = p ? postHTML(p) + composer('Votre réponse…', p.id) + e + net.replies(p.id).map(r => postHTML(r)).join('') : '<p class="mut">Post supprimé.</p>';
  } else if (view.page === 'profile') {
    const name = view.arg || me, u = net.profile(name), fl = net.followers(name), self = u.name === me;
    h = `<div class="card prof"><div class="banner" style="background:${bannerCss(u.banner)}"></div><div class="pbody">${av(u.name, true)}<b class="pname">${esc(u.display || u.name)}</b> <span class="mut">@${esc(u.name)}</span>
      <p>${esc(u.bio) || '<span class="mut">Pas de bio</span>'}</p>${u.link ? `<p><a href="${esc(u.link)}" target="_blank" rel="noopener noreferrer nofollow">🔗 ${esc(u.link.replace(/^https?:\/\//, ''))}</a></p>` : ''}
      <p class="stats"><button data-sub="followers:${u.name}" class="${view.sub === 'followers' ? 'on' : ''}"><b>${fl.length}</b> abonnés</button> <button data-sub="following:${u.name}" class="${view.sub === 'following' ? 'on' : ''}"><b>${u.following.length}</b> abonnements</button></p>` +
      (self ? `<button data-page="settings">⚙️ Modifier le profil</button>` : `<button data-follow="${u.name}">${fl.includes(me) ? 'Se désabonner' : 'Suivre'}</button> <button data-chat="${u.name}">Message</button>`) + `</div></div>${e}` +
      (view.sub ? `<div class="card"><b>${view.sub === 'followers' ? 'Abonnés' : 'Abonnements'}</b> <button data-sub="">✕</button></div>` + peopleList(view.sub === 'followers' ? fl : u.following) : list(net.byUser(name)));
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
      <button data-saveprofile>💾 Enregistrer</button> <button data-user="${u.name}">Voir mon profil</button>${e}</div>`;
  } else if (view.page === 'dm') {
    const peers = Object.values(net.db().users).filter(u => u.name !== me);
    h = `<div class="card">${peers.map(u => `<button data-chat="${u.name}" class="${view.arg === u.name ? 'on' : ''}">${esc(u.name)}</button>`).join(' ') || '<span class="mut">Personne d’autre pour l’instant.</span>'}</div>`;
    if (view.arg) h += `<div class="card" style="display:grid;gap:6px">${net.conversation(me, view.arg).map(m => `<div class="msg ${m.from === me ? 'me' : ''}">${esc(m.text)}</div>`).join('') || '<span class="mut">Dites bonjour 👋</span>'}
      <input id="dm" placeholder="Message à ${esc(view.arg)}"><button data-dm>Envoyer</button></div>${e}`;
  }
  app.innerHTML = h;
}

document.addEventListener('click', ev => {
  const d = ev.target.closest('*[data-page],*[data-like],*[data-open],*[data-del],*[data-send],*[data-user],*[data-search],*[data-login],*[data-signup],*[data-logout],*[data-follow],*[data-chat],*[data-dm],*[data-dosearch],*[data-sub],*[data-grad],*[data-saveprofile]');
  if (!d) return;
  const D = d.dataset, v = id => ($(id) || {}).value;
  if ('login' in D) attempt(async () => openSession(await net.login(v('#u'), v('#pw'))));
  else if ('signup' in D) attempt(async () => openSession(await net.signup(v('#u'), v('#pw'), v('#bio'))));
  else if ('logout' in D) { me = null; store.removeItem(SESSION); if (STREAM) attempt(async () => openSession(await net.ensureStreamer())); go('feed'); }
  else if ('page' in D) { err = ''; go(D.page); }
  else if ('send' in D) attempt(() => net.post(me, v('#txt'), D.send ? +D.send : null));
  else if ('like' in D) attempt(() => net.toggleLike(me, +D.like));
  else if ('del' in D) attempt(() => net.deletePost(me, +D.del));
  else if ('open' in D) go('thread', +D.open);
  else if ('sub' in D) { const [k, n] = D.sub.split(':'); view = { page: 'profile', arg: n, sub: k || null }; render(); }
  else if ('grad' in D) { $('#s-gradv').value = 'grad:' + D.grad; $('#s-banner').value = ''; $('#pvb').style.background = GRADS[+D.grad]; }
  else if ('saveprofile' in D) attempt(() => { net.updateProfile(me, { display: v('#s-display'), bio: v('#s-bio'), avatar: v('#s-avatar'), banner: v('#s-banner') || v('#s-gradv'), link: v('#s-link') }); if (!err) view = { page: 'profile' }; });
  else if ('user' in D) go('profile', D.user);
  else if ('follow' in D) attempt(() => net.toggleFollow(me, D.follow));
  else if ('chat' in D) go('dm', D.chat);
  else if ('dm' in D) attempt(() => net.send(me, view.arg, v('#dm')));
  else if ('search' in D) go('search', D.search);
  else if ('dosearch' in D) go('search', v('#q'));
});
render();
// « live » : la page Tendances se rafraîchit seule (les données viennent du stockage partagé)
setInterval(() => { if (me && view.page === 'trends') refresh(); }, 3000);
if (STREAM) attempt(async () => { openSession(await net.ensureStreamer()); view = { page: 'trends' }; });
