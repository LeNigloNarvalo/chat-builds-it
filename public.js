// Pages publiques et flux : /u/pseudo, /p/id, /tag/mot (HTML avec aperçu OpenGraph) et leurs flux RSS / Atom.
// Lisibles sans compte ; seuls les posts publics (hors communautés) des comptes non bannis et n'ayant pas restreint leur confidentialité sont exposés.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TAG = /#([\p{L}\p{N}_]+)/gu, FEED_MAX = 30;

function Public(net, opts = {}) {
  const lc = s => String(s || '').toLowerCase();
  const origin = req => opts.publicUrl ? String(opts.publicUrl).replace(/\/$/, '')
    : (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + String(req.headers.host || 'localhost').replace(/[^\w.:\-\[\]]/g, '');
  const banned = (d, n) => { const u = d.users[lc(n)]; return !u || (u.sanction && u.sanction.type === 'ban'); };
  const shown = (d, n) => { const u = d.users[lc(n)]; return u ? u.display || u.name : n; };
  const closed = (d, n, k) => { const u = d.users[lc(n)]; return !!(u && u.privacy && u.privacy[k] && u.privacy[k] !== 'all'); }; // confidentialité choisie par le compte
  const isPublic = (d, p) => !p.group && !banned(d, p.author) && !closed(d, p.author, 'posts');
  const recent = (d, f) => d.posts.filter(p => isPublic(d, p) && f(p)).sort((a, b) => b.id - a.id);
  const tagsOf = text => new Set((String(text).match(TAG) || []).map(t => lc(t.slice(1))));
  const clip = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const iso = ms => new Date(ms).toISOString();
  const imageOf = (p, base) => { const im = (p && !p.warn && p.images || []).find(i => /^https:\/\//.test(i.src || '')); return im ? im.src : base + '/icon.svg'; };

  const CSS = `:root{color-scheme:light dark;--bg:#fafafa;--fg:#1a1a1f;--mut:#6b6b76;--card:#fff;--bd:#e2e2e8;--ac:#9146ff}
@media(prefers-color-scheme:dark){:root{--bg:#121216;--fg:#ececf1;--mut:#9a9aa8;--card:#1c1c22;--bd:#33333d}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main,header{max-width:640px;margin:0 auto;padding:12px 16px}
header a{color:var(--ac);font-weight:700;text-decoration:none}.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 16px;margin:12px 0}
.mut{color:var(--mut);font-size:.9em}a{color:var(--ac)}.card p{white-space:pre-wrap;word-wrap:break-word;margin:.4em 0}.feeds a{margin-right:12px}img{max-width:100%;border-radius:8px}`;

  function page(req, { title, desc, path, image, type, body, feeds, noindex }) {
    const base = origin(req), url = base + path;
    const alt = (feeds || []).map(f => `<link rel="alternate" type="${f.type}" title="${esc(f.title)}" href="${esc(base + f.href)}">`).join('');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}">${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:site_name" content="Cornichon"><meta property="og:type" content="${type || 'website'}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image || base + '/icon.svg')}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">${alt}
<link rel="icon" href="/icon.svg" type="image/svg+xml"><style>${CSS}</style></head><body><header><a href="/">🥒 Cornichon</a> · <a href="/public">Pages publiques</a></header><main>${body}</main></body></html>`;
  }
  const feedLinks = (prefix, label) => [{ type: 'application/rss+xml', title: 'RSS — ' + label, href: prefix + '/feed.xml' }, { type: 'application/atom+xml', title: 'Atom — ' + label, href: prefix + '/atom.xml' }];
  const feedBar = (prefix) => `<p class="feeds mut">📡 <a href="${prefix}/feed.xml">RSS</a><a href="${prefix}/atom.xml">Atom</a></p>`;
  const postCard = (d, p) => `<article class="card"><b>${esc(shown(d, p.author))}</b> <a class="mut" href="/u/${encodeURIComponent(p.author)}">@${esc(p.author)}</a>
<p>${linkTags(p.text)}</p>${p.warn ? `<p class="mut">⚠️ Contenu sensible : ${esc(p.warn)} (médias masqués)</p>` : (p.images || []).filter(i => /^(https:\/\/|data:image\/)/.test(i.src || '')).map(i => `<img src="${esc(i.src)}" alt="${esc(i.alt || '')}" loading="lazy">`).join('')}
<div class="mut"><a class="mut" href="/p/${p.id}"><time datetime="${iso(p.at)}">${esc(new Date(p.at).toLocaleString('fr-FR', { timeZone: 'UTC' }))} UTC</time></a> · ♥ ${p.likes.length}</div></article>`;
  const linkTags = text => esc(text).replace(/#([\p{L}\p{N}_]+)/gu, (m, t) => `<a href="/tag/${encodeURIComponent(lc(t))}">${m}</a>`);

  function rss(req, { title, desc, path, posts, d }) {
    const base = origin(req);
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(title)}</title><link>${esc(base + path.replace(/\/feed\.xml$/, ''))}</link><description>${esc(desc)}</description><language>fr</language>
<atom:link href="${esc(base + path)}" rel="self" type="application/rss+xml"/>${posts.length ? `<lastBuildDate>${new Date(posts[0].at).toUTCString()}</lastBuildDate>` : ''}
${posts.map(p => `<item><title>${esc(shown(d, p.author) + ' : ' + clip(p.text, 80))}</title><link>${base}/p/${p.id}</link><guid isPermaLink="true">${base}/p/${p.id}</guid><pubDate>${new Date(p.at).toUTCString()}</pubDate><author>${esc(p.author)}</author><description>${esc(p.text)}</description></item>`).join('\n')}</channel></rss>`;
  }
  function atom(req, { title, desc, path, posts, d }) {
    const base = origin(req), self = path, home = path.replace(/\/atom\.xml$/, '');
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(title)}</title><subtitle>${esc(desc)}</subtitle><id>${esc(base + home)}</id><link rel="self" type="application/atom+xml" href="${esc(base + self)}"/><link rel="alternate" href="${esc(base + home)}"/>
<updated>${iso(posts.length ? posts[0].at : 0)}</updated>
${posts.map(p => `<entry><title>${esc(shown(d, p.author) + ' : ' + clip(p.text, 80))}</title><id>${base}/p/${p.id}</id><link rel="alternate" href="${base}/p/${p.id}"/><updated>${iso(p.at)}</updated><published>${iso(p.at)}</published><author><name>${esc(shown(d, p.author))}</name><uri>${esc(base + '/u/' + encodeURIComponent(p.author))}</uri></author><content type="text">${esc(p.text)}</content></entry>`).join('\n')}</feed>`;
  }

  // renvoie { status, type, body } ou null si l'URL n'est pas une page publique
  function handle(req, url) {
    const m = /^\/(u|tag|p)\/([^/]+)(?:\/(feed\.xml|atom\.xml))?$/.exec(url.pathname), d = net.db();
    const base = origin(req);
    const feed = (file, ctx) => ({ status: 200, type: file === 'feed.xml' ? 'application/rss+xml; charset=utf-8' : 'application/atom+xml; charset=utf-8', body: (file === 'feed.xml' ? rss : atom)(req, ctx) });
    const miss = (what) => ({ status: 404, type: 'text/html; charset=utf-8', body: page(req, { title: 'Introuvable — Cornichon', desc: what + ' introuvable.', path: url.pathname, noindex: true, body: `<div class="card"><h1>🫙 ${esc(what)} introuvable</h1><p><a href="/public">Voir les pages publiques</a></p></div>` }) });
    if (url.pathname === '/public') {
      const posts = recent(d, p => !p.replyTo).slice(0, 30);
      return { status: 200, type: 'text/html; charset=utf-8', body: page(req, { title: 'Pages publiques — Cornichon', desc: 'Les derniers posts publics du bocal, lisibles sans compte.', path: '/public', feeds: feedLinks('/public', 'Tout Cornichon'), body: `<h1>🌍 Pages publiques</h1>${feedBar('/public')}${posts.map(p => postCard(d, p)).join('') || '<p class="mut">Rien de publié pour l’instant.</p>'}` }) };
    }
    const pf = /^\/public\/(feed\.xml|atom\.xml)$/.exec(url.pathname);
    let kind, key, file;
    if (pf) { kind = 'all'; file = pf[1]; } else if (m) { [, kind, key, file] = m; try { key = decodeURIComponent(key); } catch (e) { return miss('Page'); } } else return null;
    if (kind === 'all') { const ctx = { title: 'Cornichon — posts publics', desc: 'Tous les posts publics de Cornichon.', path: url.pathname, posts: recent(d, p => !p.replyTo).slice(0, FEED_MAX), d }; return feed(file, ctx); }
    if (kind === 'u') {
      const u = d.users[lc(key)]; if (!u || banned(d, u.name) || closed(d, u.name, 'profile')) return miss('Profil');
      const all = recent(d, p => lc(p.author) === lc(u.name)), top = all.filter(p => !p.replyTo), name = u.display || u.name, prefix = '/u/' + encodeURIComponent(u.name);
      const desc = clip(u.bio || `Posts publics de @${u.name} sur Cornichon.`, 200);
      if (file) return feed(file, { title: `${name} (@${u.name}) — Cornichon`, desc, path: url.pathname, posts: top.slice(0, FEED_MAX), d });
      return { status: 200, type: 'text/html; charset=utf-8', body: page(req, { title: `${name} (@${u.name}) — Cornichon`, desc, path: prefix, type: 'profile', feeds: feedLinks(prefix, '@' + u.name),
        body: `<div class="card"><h1>${esc(name)} <span class="mut">@${esc(u.name)}</span></h1><p>${esc(u.bio || '')}</p>${u.link && /^https?:\/\//.test(u.link) ? `<p><a href="${esc(u.link)}" rel="noopener noreferrer nofollow">🔗 ${esc(u.link.replace(/^https?:\/\//, ''))}</a></p>` : ''}<p class="mut">${top.length} post${top.length > 1 ? 's' : ''} public${top.length > 1 ? 's' : ''}</p></div>${feedBar(prefix)}${top.slice(0, 50).map(p => postCard(d, p)).join('') || '<p class="mut">Rien de publié pour l’instant.</p>'}` }) };
    }
    if (kind === 'tag') {
      const tag = lc(key); if (!/^[\p{L}\p{N}_]+$/u.test(tag)) return miss('Hashtag');
      const posts = recent(d, p => !p.replyTo && tagsOf(p.text).has(tag)), prefix = '/tag/' + encodeURIComponent(tag);
      if (file) return feed(file, { title: `#${tag} — Cornichon`, desc: `Posts publics avec #${tag}.`, path: url.pathname, posts: posts.slice(0, FEED_MAX), d });
      return { status: 200, type: 'text/html; charset=utf-8', body: page(req, { title: `#${tag} — Cornichon`, desc: `${posts.length} post${posts.length > 1 ? 's' : ''} public${posts.length > 1 ? 's' : ''} avec #${tag}.`, path: prefix, feeds: feedLinks(prefix, '#' + tag),
        body: `<h1>#${esc(tag)}</h1>${feedBar(prefix)}${posts.slice(0, 50).map(p => postCard(d, p)).join('') || '<p class="mut">Aucun post public avec ce hashtag.</p>'}` }) };
    }
    // post
    const p = d.posts.find(x => x.id === +key && /^\d+$/.test(key));
    if (!p || file || !isPublic(d, p)) return miss('Post');
    const parent = p.replyTo && d.posts.find(x => x.id === p.replyTo), replies = recent(d, r => r.replyTo === p.id).reverse();
    const name = shown(d, p.author), text = p.text || (p.images && p.images.length ? '📷 Image' : '');
    return { status: 200, type: 'text/html; charset=utf-8', body: page(req, { title: `${name} (@${p.author}) sur Cornichon : « ${clip(text, 70)} »`, desc: clip(text, 200), path: '/p/' + p.id, type: 'article', image: imageOf(p, base),
      feeds: feedLinks('/u/' + encodeURIComponent(p.author), '@' + p.author),
      body: `${parent && isPublic(d, parent) ? `<p class="mut">En réponse à <a href="/p/${parent.id}">@${esc(parent.author)}</a></p>` : ''}${postCard(d, p)}${replies.length ? `<h2>💬 Réponses</h2>${replies.map(r => postCard(d, r)).join('')}` : ''}<p class="mut">Flux de l’auteur : <a href="/u/${encodeURIComponent(p.author)}/feed.xml">RSS</a> · <a href="/u/${encodeURIComponent(p.author)}/atom.xml">Atom</a></p>` }) };
  }
  return { handle };
}
module.exports = { Public };
