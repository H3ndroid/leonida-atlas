/* Leonida Atlas – Service Worker: Offline-Betrieb und Hintergrund-Aktualisierung */
importScripts('data.js');
const VERSION = 'la-v2';
const SHELL = ['./', 'index.html', 'app.js', 'data.js', 'i18n.js', 'seed.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const IMG_CACHE = 'la-img';
const IMG_HOSTS = ['static.wikia.nocookie.net', 'upload.wikimedia.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== IMG_CACHE && k !== 'la-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // App-Dateien: sofort aus dem Cache, im Hintergrund aktualisieren
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || c.match('index.html'));
      return hit || net;
    }));
    return;
  }
  // Schriften
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('la-fonts').then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  // Bilder aus den Wikis für die Offline-Nutzung zwischenspeichern
  if (IMG_HOSTS.includes(url.hostname) && req.destination === 'image') {
    e.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trim(IMG_CACHE, 1500); }
      return r;
    }).catch(() => Response.error()));
  }
  // API-Anfragen gehen direkt ins Netz
});

async function backgroundRefresh() {
  const res = await self.LA.refresh({ reason: 'background' });
  if (res.skipped) return;
  const s = await self.LA.getSettings();
  if (s.offline) await self.LA.prefetchAll();
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'updated' }));
  const n = (res.added || 0) + (res.changed || 0);
  if (n && s.notify && self.Notification && Notification.permission === 'granted' && !clients.some(c => c.visibilityState === 'visible')) {
    const tpl = self.LA.NOTIFY[s.lang] || self.LA.NOTIFY.en;
    await self.registration.showNotification('Leonida Atlas', {
      body: tpl.replace('{n}', n), lang: s.lang || 'en', dir: s.lang === 'ar' ? 'rtl' : 'ltr', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'la-update', data: { url: './#neu' }
    });
  }
}
self.addEventListener('periodicsync', e => { if (e.tag === 'la-refresh') e.waitUntil(backgroundRefresh()); });
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { c.navigate(e.notification.data.url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(e.notification.data.url);
  }));
});
