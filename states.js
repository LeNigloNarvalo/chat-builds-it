// États d'écran cohérents : chargement, liste vide, erreur (avec « Réessayer »), 404 et 500 ; conservation de la saisie en cas d'échec.
(function (root) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tr = (k, p) => (root.I18n || (typeof require !== 'undefined' ? require('./i18n.js') : null)).t(k, p);
  // nature d'une erreur d'après son message (les erreurs viennent du serveur ou de la couche réseau)
  const kind = m => { m = String(m && m.message || m || ''); return /injoignable|Failed to fetch|NetworkError|Load failed|hors.?ligne/i.test(m) ? 'network' : /Erreur interne|erreur du serveur|\b50\d\b/i.test(m) ? 'server' : /introuvable|inconnue|supprimé|n'existe pas/i.test(m) ? 'notfound' : 'other'; };
  const box = (cls, icon, title, text, actions, role) => `<div class="card state ${cls}" role="${role}"><div class="sicon" aria-hidden="true">${icon}</div><h2>${esc(title)}</h2>${text ? `<p class="mut">${esc(text)}</p>` : ''}${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
  const retry = () => `<button data-retry>${esc(tr('state.retry'))}</button>`;
  const home = () => `<button data-page="feed">${esc(tr('state.home'))}</button>`;
  const api = {
    kind, esc,
    loading: msg => `<div class="card state loading" role="status" aria-live="polite" aria-busy="true"><span class="spin" aria-hidden="true"></span> <span class="mut">${esc(msg || tr('state.loading'))}</span><div class="skel" aria-hidden="true"><i></i><i></i><i></i></div></div>`,
    empty: (icon, title, hint, action) => box('empty', icon, title || tr('state.empty.title'), hint, action || '', 'status'),
    // erreur : message du serveur affiché tel quel ; coupure réseau et erreur 500 ont leurs textes dédiés
    error: (message, o) => {
      o = o || {}; const k = kind(message), keep = o.kept ? ' ' + tr('state.kept') : '';
      const [icon, title, text] = k === 'network' ? ['📴', tr('state.net.title'), tr('state.net.text')] : k === 'server' ? ['💥', tr('state.srv.title'), tr('state.srv.text')] : ['⚠️', tr('state.err.title'), String(message) + (o.kept ? keep : '')];
      return box('error ' + k + ' err', icon, title, text, (o.retry === false ? '' : retry()) + (o.home ? home() : ''), 'alert');
    },
    notFound: what => box('error nf', '🧭', tr('state.nf.title'), what || tr('state.nf.text'), home(), 'alert'),
    serverError: () => box('error srv err', '💥', tr('state.srv.title'), tr('state.srv.text'), retry() + home(), 'alert'),
    // saisie à conserver quand une action échoue : champs de formulaire (hors mots de passe), restaurés après le nouveau rendu
    snapshot: root_ => { const out = []; for (const x of root_.querySelectorAll('input[id],textarea[id],select[id]')) { if (x.type === 'password' || x.type === 'file' || x.type === 'hidden') continue; out.push([x.id, x.type === 'checkbox' || x.type === 'radio' ? x.checked : x.value]); } return out; },
    restore: (doc, snap) => { for (const [id, v] of snap) { const x = doc.getElementById(id); if (!x) continue; if (typeof v === 'boolean') x.checked = v; else if (v !== '' && x.value !== v) x.value = v; } },
    // bandeau de connexion : 'off' (coupée), 'retry' (essai en cours), 'back' (rétablie), sinon vide
    bar: s => s === 'off' ? tr('offline.bar') : s === 'retry' ? tr('offline.retrying') : s === 'back' ? tr('offline.back') : '',
    // page d'erreur autonome servie par le serveur pour une navigation (404/500), sans dépendre de l'appli
    page: (code, lang) => {
      const T = { 404: ['Page introuvable', 'Cette page n’existe pas ou a été supprimée.', '🧭'], 500: ['Erreur du serveur', 'Quelque chose s’est mal passé de notre côté. Réessayez dans un instant.', '💥'] }[code] || ['Erreur', 'Une erreur est survenue.', '⚠️'];
      return `<!doctype html><html lang="${lang || 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${code} — Cornichon</title><link rel="stylesheet" href="/style.css"></head><body><main><div class="card state error" role="alert"><div class="sicon" aria-hidden="true">${T[2]}</div><h2>${code} · ${T[0]}</h2><p class="mut">${T[1]}</p><div class="row"><a href="/"><button>🏠 Retour à l’accueil</button></a>${code === 500 ? '<a href=""><button>🔄 Réessayer</button></a>' : ''}</div></div></main></body></html>`;
    },
  };
  if (typeof module !== 'undefined') module.exports = api; else root.States = api;
})(this);
