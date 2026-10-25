// Vue stream (?stream=1) : session démo admin en mémoire, sans toucher aux vraies données
const STREAM = new URLSearchParams(location.search).get('stream') === '1';
const mem = { d: {}, getItem(k) { return k in this.d ? this.d[k] : null; }, setItem(k, v) { this.d[k] = v; }, removeItem(k) { delete this.d[k]; } };
const store = STREAM ? mem : localStorage;
const net = Social.Net(store);
let me = STREAM ? net.seedDemo() : localStorage.getItem('twitchgram.me');
if (me) { try { net.profile(me); } catch (e) { me = null; } }
let view = { page: 'feed' };
const $ = s => document.querySelector(s);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rich = s => esc(s).replace(/#\w+/g, t => `<span class="tag" data-search="${t}">${t}</span>`).replace(/@\w+/g, t => `<span class="mention" data-user="${t.slice(1)}">${t}</span>`);
const color = n => `hsl(${[...n].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360},60%,45%)`;
const av = n => `<span class="av" style="background:${color(n)}">${esc(n[0].toUpperCase())}</span>`;
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'à l’instant' : m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' j'; };
const go = (page, arg) => { view = { page, arg }; render(); };
let err = '';
const attempt = f => { try { err = ''; f(); } catch (e) { err = e.message; } render(); };

function postHTML(p, thread) {
  const liked = me && p.likes.includes(me), n = net.replies(p.id).length;
  return `<div class="card post">${av(p.author)}<span class="who" data-user="${p.author}">${esc(p.author)}</span> <span class="mut">· ${ago(p.at)}</span>
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
  nav.innerHTML = [['feed', '🏠 Mon fil'], ['explore', '🌍 Explorer'], ['trends', '🔥 Tendances'], ['search', '🔎 Recherche'], ['notifs', `🔔 ${unread || ''}`], ['dm', '✉️ Messages'], ['profile', '👤 Profil']]
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
      r.users.map(u => `<div class="card">${av(u.name)}<span class="who" data-user="${u.name}">${esc(u.name)}</span> <span class="mut">${esc(u.bio)}</span></div>`).join('') + list(r.posts);
  } else if (view.page === 'notifs') {
    const L = { like: 'a aimé votre post', reply: 'a répondu à votre post', mention: 'vous a mentionné', follow: 'vous suit' };
    h = net.notifications(me, true).map(n => `<div class="card" ${n.postId ? `data-open="${n.postId}"` : `data-user="${n.from}"`}><b>${esc(n.from)}</b> ${L[n.type]} <span class="mut">· ${ago(n.at)}</span></div>`).join('') || '<p class="mut">Aucune notification.</p>';
  } else if (view.page === 'thread') {
    const p = net.db().posts.find(x => x.id === view.arg);
    h = p ? postHTML(p) + composer('Votre réponse…', p.id) + e + net.replies(p.id).map(r => postHTML(r)).join('') : '<p class="mut">Post supprimé.</p>';
  } else if (view.page === 'profile') {
    const name = view.arg || me, u = net.profile(name), fl = net.followers(name);
    h = `<div class="card">${av(u.name)}<b>${esc(u.name)}</b><p>${esc(u.bio) || '<span class="mut">Pas de bio</span>'}</p><p class="mut">${fl.length} abonnés · ${u.following.length} abonnements</p>` +
      (u.name !== me ? `<button data-follow="${u.name}">${fl.includes(me) ? 'Se désabonner' : 'Suivre'}</button> <button data-chat="${u.name}">Message</button>` : '') + `</div>${e}` + list(net.byUser(name));
  } else if (view.page === 'dm') {
    const peers = Object.values(net.db().users).filter(u => u.name !== me);
    h = `<div class="card">${peers.map(u => `<button data-chat="${u.name}" class="${view.arg === u.name ? 'on' : ''}">${esc(u.name)}</button>`).join(' ') || '<span class="mut">Personne d’autre pour l’instant.</span>'}</div>`;
    if (view.arg) h += `<div class="card" style="display:grid;gap:6px">${net.conversation(me, view.arg).map(m => `<div class="msg ${m.from === me ? 'me' : ''}">${esc(m.text)}</div>`).join('') || '<span class="mut">Dites bonjour 👋</span>'}
      <input id="dm" placeholder="Message à ${esc(view.arg)}"><button data-dm>Envoyer</button></div>${e}`;
  }
  app.innerHTML = h;
}

document.addEventListener('click', ev => {
  const d = ev.target.closest('*[data-page],*[data-like],*[data-open],*[data-del],*[data-send],*[data-user],*[data-search],*[data-login],*[data-signup],*[data-logout],*[data-follow],*[data-chat],*[data-dm],*[data-dosearch]');
  if (!d) return;
  const D = d.dataset, v = id => ($(id) || {}).value;
  if ('login' in D) attempt(() => { me = net.login(v('#u'), v('#pw')); store.setItem('twitchgram.me', me); });
  else if ('signup' in D) attempt(() => { me = net.signup(v('#u'), v('#pw'), v('#bio')); store.setItem('twitchgram.me', me); });
  else if ('logout' in D) { me = null; store.removeItem('twitchgram.me'); if (STREAM) me = net.seedDemo(); go('feed'); }
  else if ('page' in D) { err = ''; go(D.page); }
  else if ('send' in D) attempt(() => net.post(me, v('#txt'), D.send ? +D.send : null));
  else if ('like' in D) attempt(() => net.toggleLike(me, +D.like));
  else if ('del' in D) attempt(() => net.deletePost(me, +D.del));
  else if ('open' in D) go('thread', +D.open);
  else if ('user' in D) go('profile', D.user);
  else if ('follow' in D) attempt(() => net.toggleFollow(me, D.follow));
  else if ('chat' in D) go('dm', D.chat);
  else if ('dm' in D) attempt(() => net.send(me, view.arg, v('#dm')));
  else if ('search' in D) go('search', D.search);
  else if ('dosearch' in D) go('search', v('#q'));
});
render();
// « live » : la page Tendances se rafraîchit seule ; en vue stream, des spectateurs simulés likent et postent
const BOTS = ['Luna', 'Pixel', 'Neo'], TAGS = ['#twitch', '#opensource', '#live', '#code', '#pixelart', '#gg'];
const pick = l => l[Math.floor(Math.random() * l.length)];
setInterval(() => {
  if (!me) return;
  if (STREAM) try {
    const bot = pick(BOTS), roots = net.explore();
    if (Math.random() < 0.3) net.post(bot, `${pick(['Ça chauffe', 'Quel live', 'Trop fort'])} ! ${pick(TAGS)}`);
    else if (roots.length) { const p = pick(roots); if (!p.likes.includes(bot)) net.toggleLike(bot, p.id); }
  } catch (e) {}
  if (view.page === 'trends') render();
}, 3000);
if (STREAM) go('trends');
