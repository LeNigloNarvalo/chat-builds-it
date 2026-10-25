// Service worker Agora : coque de l'appli en cache, fil et état servis hors-ligne (réseau d'abord), notifications.
const SHELL = 'cornichon-shell-v15', DATA = 'cornichon-data-v1';
const FILES = ['/', '/style.css', '/a11y.js', '/i18n.js', '/theme.js', '/states.js', '/help.js', '/social.js', '/sync.js', '/qrcode.js', '/stats.js', '/calls.js', '/automod.js', '/diag.js', '/quality.js', '/app.js', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// les données en cache sont propres à une session : la clé contient l'en-tête Authorization, jamais partagée entre comptes
const dataKey = req => { const u = new URL(req.url); u.searchParams.delete('v'); u.searchParams.delete('_'); return new Request(u.origin + '/__cache' + u.pathname + u.search + (u.search ? '&' : '?') + 'k=' + encodeURIComponent(req.headers.get('Authorization') || '')); };
const cacheable = u => u.pathname === '/api/state' || (u.pathname === '/api/feed' && !u.searchParams.has('before') && !u.searchParams.has('after'));
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (cacheable(u)) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        if (r.ok) { const j = await r.clone().json().catch(() => null); if (j && !j.unchanged) (await caches.open(DATA)).put(dataKey(req), r.clone()); else if (j && j.unchanged) { const c = await (await caches.open(DATA)).match(dataKey(req)); if (!c) return fetch(new Request(req.url.replace(/([?&])v=-?\d+/, '$1v=-1'), req)); } }
        return r;
      } catch (err) {
        const c = await (await caches.open(DATA)).match(dataKey(req));
        if (c) return c;
        throw err;
      }
    })());
  } else if (!u.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const k = r.clone(); caches.open(SHELL).then(c => c.put(req, k)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/'))));
  }
});
self.addEventListener('message', e => { if (e.data === 'clear-data') e.waitUntil(caches.delete(DATA)); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs[0]; if (!c) return self.clients.openWindow('/?notif=1');
    c.postMessage({ openNotifs: true }); return c.focus();
  }));
});
