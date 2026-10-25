// Notifications de l'appli installable : réglages par type (propres à l'appareil) et choix de ce qu'il faut afficher.
(function (root) {
  const KEY = 'app.notifprefs', SEEN = 'app.notifseen.', TYPES = { mention: '@ Mentions', reply: '💬 Réponses', follow: '👤 Nouveaux abonnés' };
  const TEXT = { mention: 'vous a mentionné', reply: 'a répondu à votre post', follow: 'vous suit maintenant' };
  const load = store => { let o = {}; try { o = JSON.parse(store.getItem(KEY) || '{}') || {}; } catch (e) {} return { enabled: !!o.enabled, types: Object.assign({ mention: true, reply: true, follow: true }, o.types) }; };
  const save = (store, p) => store.setItem(KEY, JSON.stringify(p));
  // notifications à afficher : plus récentes que la dernière vue, non lues, du type activé ; renvoie aussi le nouveau repère
  function pick(list, prefs, lastSeen) {
    const max = list.reduce((m, n) => Math.max(m, n.id), 0);
    if (lastSeen == null) return { show: [], seen: max };
    const show = prefs.enabled ? list.filter(n => n.id > lastSeen && !n.read && TYPES[n.type] && prefs.types[n.type]).sort((a, b) => a.id - b.id) : [];
    return { show, seen: Math.max(max, lastSeen) };
  }
  const seenGet = (store, me) => { const v = store.getItem(SEEN + me); return v === null ? null : +v; };
  const seenSet = (store, me, v) => store.setItem(SEEN + me, String(v));
  const supported = () => typeof Notification !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  async function show(n, name) {
    const o = { body: `${name} ${TEXT[n.type]}`, icon: 'icon.svg', badge: 'icon.svg', tag: 'cornichon-' + n.id, data: { id: n.id } };
    try { const reg = await navigator.serviceWorker.ready; return await reg.showNotification('🥒 Cornichon', o); } catch (e) { new Notification('🥒 Cornichon', o); }
  }
  const api = { KEY, TYPES, TEXT, load, save, pick, seenGet, seenSet, supported, show };
  if (typeof module !== 'undefined') module.exports = api; else root.Notif = api;
})(this);
