// Planner – service worker: de app zelf werkt ook zonder internet (je gegevens komen uit de laatste stand).
const VERSIE = 'planner-v1';
const BESTANDEN = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIE).then(c => c.addAll(BESTANDEN)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSIE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google-verkeer nooit cachen
  // eerst internet (zodat updates meteen binnenkomen), anders de bewaarde versie
  e.respondWith(fetch(e.request).then(r => {
    const kopie = r.clone(); caches.open(VERSIE).then(c => c.put(e.request, kopie)); return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
