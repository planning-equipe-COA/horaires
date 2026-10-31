// Mes Horaires — fonctionnement hors connexion.
// Réseau d'abord : en ligne, on sert toujours la dernière version publiée (et on met la copie à
// jour) ; sans réseau, ou s'il ne répond pas assez vite, on sert la copie gardée sur le téléphone.
// Aucune donnée de planning ne passe ici : elle reste dans le localStorage de la page.
const CACHE = 'mh-app-v8';
const FILES = [
  './', 'index.html', 'app.js', 'core.js', 'team.js', 'style.css', 'xlsx.full.min.js',
  'manifest.json?v=3', 'icon-192.png?v=2', 'icon-512.png?v=2', 'apple-touch-icon.png?v=2',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromCache(request) {
  return caches.match(request).then(hit => {
    if (hit || request.mode !== 'navigate') return hit;
    return caches.match('./').then(page => page || caches.match('index.html'));
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(new Promise(resolve => {
    let done = false;
    const answer = res => { if (!done && res) { done = true; resolve(res); } };

    // « no-cache » : on revérifie auprès du serveur au lieu de se fier au cache HTTP du navigateur
    const network = fetch(request, { cache: 'no-cache' }).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      answer(res);
      return res;
    });

    const fallback = () => fromCache(request).then(hit => {
      if (hit) answer(hit);
      return hit;
    });
    const timer = setTimeout(fallback, NETWORK_TIMEOUT_MS);
    network.catch(() => fallback().then(hit => {
      if (!hit) answer(Response.error());
    })).finally(() => clearTimeout(timer));
  }));
});
