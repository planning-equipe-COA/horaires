// Boîte à outils COA — copie hors connexion (réseau d'abord, copie du téléphone si pas de réseau).
// Changer CACHE purge l'ancienne copie.
const CACHE = 'coa-outils-v1';
const FILES = ['./', 'index.html', 'airports.json', 'airlines.json', 'aircraft.json', 'manifest.json', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('coa-outils') && x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true })));
});
