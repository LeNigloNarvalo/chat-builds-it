// Statistiques personnelles : calcul pur à partir des données sociales (posts, likes, réponses, abonnements) et du journal des vues.
// Jours et heures sont ceux du fuseau du lecteur (tz = décalage en minutes, comme Date.getTimezoneOffset()).
(function (root) {
  const DAY = 86400000, MAX_DAYS = 90;
  const lc = s => String(s || '').toLowerCase();
  // views : [{ post, at }] pour les posts de l'auteur ; d : données du moteur (net.db())
  function compute(d, views, name, days, tz, now) {
    days = Math.min(MAX_DAYS, Math.max(1, Math.floor(+days) || 14)); tz = Math.max(-840, Math.min(840, Math.floor(+tz) || 0)); now = now || Date.now();
    const local = t => t - tz * 60000, dayOf = t => Math.floor(local(t) / DAY), today = dayOf(now), first = today - days + 1;
    const mine = d.posts.filter(p => lc(p.author) === lc(name) && !p.replyTo), mineAll = new Map(d.posts.filter(p => lc(p.author) === lc(name)).map(p => [p.id, p]));
    const series = Array.from({ length: days }, (_, i) => ({ day: new Date((first + i) * DAY).toISOString().slice(0, 10), views: 0, reactions: 0, replies: 0, followers: 0 }));
    const hours = Array.from({ length: 24 }, () => 0);
    const per = new Map(mine.map(p => [p.id, { id: p.id, text: p.text, at: p.at, views: 0, reactions: 0, replies: 0 }]));
    const bump = (t, k) => { const i = dayOf(t) - first; if (i >= 0 && i < days) { series[i][k]++; return true; } return false; };
    const hour = t => { const h = new Date(local(t)).getUTCHours(); hours[h]++; };
    for (const v of views) {
      const p = per.get(v.post); if (!p) continue;
      if (bump(v.at, 'views')) p.views++; // classement sur la période affichée
    }
    // réactions : un like compte à la date de sa notification, tant que le like existe encore
    for (const n of d.notifs) {
      if (lc(n.to) !== lc(name)) continue;
      const p = n.postId && mineAll.get(n.postId);
      if (n.type === 'like' && p && p.likes.some(x => lc(x) === lc(n.from))) { if (bump(n.at, 'reactions')) { hour(n.at); if (per.has(p.id)) per.get(p.id).reactions++; } }
      else if (n.type === 'follow' && (d.users[lc(n.from)] || { following: [] }).following.some(x => lc(x) === lc(name))) { if (bump(n.at, 'followers')) hour(n.at); }
    }
    for (const r of d.posts) {
      const p = r.replyTo && mineAll.get(r.replyTo); if (!p || lc(r.author) === lc(name)) continue;
      if (bump(r.at, 'replies')) { hour(r.at); if (per.has(p.id)) per.get(p.id).replies++; }
    }
    for (const v of views) if (per.has(v.post) && dayOf(v.at) >= first) hour(v.at);
    const sum = k => series.reduce((s, x) => s + x[k], 0);
    const score = p => p.views + 5 * p.reactions + 8 * p.replies;
    const top = [...per.values()].map(p => Object.assign(p, { score: score(p) })).filter(p => p.score > 0).sort((a, b) => b.score - a.score || b.at - a.at).slice(0, 5);
    const total = { posts: mine.length, followers: Object.values(d.users).filter(u => (u.following || []).some(x => lc(x) === lc(name))).length };
    return { days, series, hours, top, totals: { views: sum('views'), reactions: sum('reactions'), replies: sum('replies'), followers: sum('followers') }, total };
  }
  const api = { compute, MAX_DAYS };
  if (typeof module !== 'undefined') module.exports = api; else root.Stats = api;
})(this);
