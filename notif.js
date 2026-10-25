// Notifications de l'appli installable : réglages par type (propres à l'appareil) et choix de ce qu'il faut afficher.
(function (root) {
  const KEY = 'app.notifprefs', SEEN = 'app.notifseen.', TYPES = { mention: '@ Mentions', reply: '💬 Réponses', follow: '👤 Nouveaux abonnés', poll: '📊 Sondages clos', group: '👥 Communautés', search: '🔎 Recherches enregistrées', event: '📅 Événements' };
  const TEXT = { mention: 'vous a mentionné', reply: 'a répondu à votre post', follow: 'vous suit maintenant', poll: 'Votre sondage est terminé', search: 'a de nouveaux résultats', event: { reminder: 'Rappel : l’événement commence bientôt', moved: 'a déplacé un événement', cancelled: 'a annulé un événement', yes: 'vient à votre événement', maybe: 'viendra peut-être à votre événement', no: 'ne vient pas à votre événement' }, group: { invite: 'vous invite dans une communauté', request: 'demande à rejoindre votre communauté', accepted: 'vous a accepté dans une communauté', mod: 'vous a nommé modérateur', removed: 'vous a retiré d’une communauté', banned: 'vous a banni d’une communauté' } };
  const load = store => { let o = {}; try { o = JSON.parse(store.getItem(KEY) || '{}') || {}; } catch (e) {} return { enabled: !!o.enabled, types: Object.assign({ mention: true, reply: true, follow: true, poll: true, group: true, search: true, event: true }, o.types) }; };
  const save = (store, p) => store.setItem(KEY, JSON.stringify(p));
  // préférences du compte (centre de notifications) : canal « push » du type activé et hors heures calmes
  const allowed = (account, type, at) => !account || ((!account.prefs.types[type] || account.prefs.types[type].push) && !account.inQuiet(account.prefs, at));
  // notifications à afficher : plus récentes que la dernière vue, non lues, du type activé ; renvoie aussi le nouveau repère
  function pick(list, prefs, lastSeen, account) {
    const max = list.reduce((m, n) => Math.max(m, n.id), 0);
    if (lastSeen == null) return { show: [], seen: max };
    const show = prefs.enabled ? list.filter(n => n.id > lastSeen && !n.read && TYPES[n.type] && prefs.types[n.type] && allowed(account, n.type)).sort((a, b) => a.id - b.id) : [];
    return { show, seen: Math.max(max, lastSeen) };
  }
  const seenGet = (store, me) => { const v = store.getItem(SEEN + me); return v === null ? null : +v; };
  const seenSet = (store, me, v) => store.setItem(SEEN + me, String(v));
  const supported = () => typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  async function show(n, name) {
    const o = { body: n.type === 'event' ? `📅 ${n.title} — ${TEXT.event[n.what] || 'événement'}` : n.type === 'group' ? `${name} ${TEXT.group[n.what] || 'communauté'}` : n.type === 'poll' ? TEXT.poll + ' : voir les résultats' : n.type === 'search' ? `🔎 « ${n.name} » : ${n.count} nouveau${n.count > 1 ? 'x' : ''} résultat${n.count > 1 ? 's' : ''}` : `${name} ${TEXT[n.type]}`, icon: 'icon.svg', badge: 'icon.svg', tag: 'cornichon-' + n.id, data: { id: n.id } };
    try { const reg = await navigator.serviceWorker.ready; return await reg.showNotification('🥒 Cornichon', o); } catch (e) { new Notification('🥒 Cornichon', o); }
  }
  const api = { KEY, TYPES, TEXT, load, save, pick, seenGet, seenSet, supported, show, allowed };
  if (typeof module !== 'undefined') module.exports = api; else root.Notif = api;
})(this);
