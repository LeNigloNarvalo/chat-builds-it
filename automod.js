// Modération automatique des communautés : moteur de règles pur (aucun accès au stockage).
// Une règle = un type (mots interdits, liens, compte trop récent, rafale de signalements) + une action (masquer, valider avant, avertir).
(function (root) {
  const TYPES = {
    words: { icon: '🤬', label: 'Mots interdits', hint: 'Mots ou expressions séparés par des virgules (sans tenir compte des accents ni des majuscules).' },
    links: { icon: '🔗', label: 'Liens', hint: 'Domaines autorisés, séparés par des virgules (ex. twitch.tv). Laisser vide : tout lien déclenche la règle.' },
    newaccount: { icon: '🐣', label: 'Compte trop récent', hint: 'Âge minimum du compte, en heures (1 à 720).' },
    reports: { icon: '🚩', label: 'Rafale de signalements', hint: 'Nombre de signalements reçus par un même post en 30 minutes (2 à 50).' },
  };
  const ACTIONS = { hide: { icon: '🙈', label: 'Masquer' }, queue: { icon: '⏳', label: 'Mettre en file de validation' }, warn: { icon: '⚠️', label: 'Avertir' } };
  const MAX_RULES = 20, MAX_LOG = 300, BURST_MS = 30 * 60000;

  const norm = s => ' ' + String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  const list = v => String(v == null ? '' : v).split(/[,\n]/).map(x => x.trim()).filter(Boolean);
  const LINK_RE = /(?:https?:\/\/|www\.)[^\s<>"]+|\b(?:[a-z0-9-]+\.)+(?:com|fr|net|org|io|tv|gg|me|co|ly|xyz|info|app|dev|be|ch|ca|de|eu|ru|cc|link|live|shop|club|online|site|top)\b(?:\/[^\s<>"]*)?/gi;
  const host = u => { const m = /^(?:https?:\/\/)?(?:www\.)?([^\/\s:?#]+)/i.exec(u); return m ? m[1].toLowerCase() : ''; };
  const domainOk = (h, allowed) => allowed.some(a => h === a || h.endsWith('.' + a));

  // valide et normalise une règle saisie ; lève une Error en français
  function clean(o) {
    o = o || {}; const name = String(o.name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 40) throw new Error('Nom de la règle : 1 à 40 caractères');
    if (!TYPES[o.type]) throw new Error('Type de règle inconnu');
    if (!ACTIONS[o.action]) throw new Error('Action inconnue');
    let value;
    if (o.type === 'words') {
      value = list(o.value).map(w => w.slice(0, 40)); if (!value.length) throw new Error('Indiquez au moins un mot interdit'); if (value.length > 50) throw new Error('50 mots maximum par règle');
      value = value.filter((w, i) => value.findIndex(x => norm(x) === norm(w)) === i);
    } else if (o.type === 'links') {
      value = list(o.value).map(d => host(d)).filter(Boolean); if (value.length > 10) throw new Error('10 domaines autorisés maximum');
    } else {
      const n = Math.floor(Number(o.value)), [lo, hi] = o.type === 'newaccount' ? [1, 720] : [2, 50];
      if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(o.type === 'newaccount' ? 'Âge minimum : 1 à 720 heures' : 'Seuil de signalements : 2 à 50');
      value = n;
    }
    return { name, type: o.type, action: o.action, value, on: o.on !== false };
  }

  // la règle s'applique-t-elle à ce contexte ? ctx = { text, joined, now, reports: [instants de signalement] } ; renvoie le motif ou null
  function match(rule, ctx) {
    const t = rule.type, v = rule.value;
    if (t === 'words') { const x = norm(ctx.text), w = (v || []).find(k => norm(k).trim() && x.includes(norm(k))); return w ? 'mot interdit « ' + w + ' »' : null; }
    if (t === 'links') { const hit = (String(ctx.text || '').match(LINK_RE) || []).map(host).find(h => h && !domainOk(h, v || [])); return hit ? 'lien vers ' + hit : null; }
    if (t === 'newaccount') { const h = ((ctx.now || Date.now()) - (ctx.joined || 0)) / 3600000; return h < v ? 'compte créé il y a ' + (h < 1 ? 'moins d’1 h' : Math.floor(h) + ' h') + ' (minimum ' + v + ' h)' : null; }
    if (t === 'reports') { const now = ctx.now || Date.now(), n = (ctx.reports || []).filter(a => now - a < BURST_MS).length; return n >= v ? n + ' signalements en 30 min' : null; }
    return null;
  }
  // première règle active qui s'applique (les règles les plus sévères d'abord : masquer > valider > avertir)
  const RANK = { hide: 0, queue: 1, warn: 2 };
  function evaluate(rules, ctx, only) {
    for (const r of (rules || []).filter(x => x.on !== false && (!only || only(x))).sort((a, b) => RANK[a.action] - RANK[b.action])) { const why = match(r, ctx); if (why) return { rule: r, why }; }
    return null;
  }

  const api = { TYPES, ACTIONS, MAX_RULES, MAX_LOG, BURST_MS, norm, clean, match, evaluate };
  if (typeof module !== 'undefined') module.exports = api; else root.Automod = api;
})(this);
