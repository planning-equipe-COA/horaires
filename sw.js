// Planning COA — fonctionnement hors connexion et ouverture instantanée.
// L'appli s'ouvre toujours depuis la copie gardée sur le téléphone (immédiat, même avec un réseau faible ou
// absent). À chaque ouverture, on vérifie en arrière-plan s'il y a une nouvelle version : si un fichier a
// changé, toute la copie est remplacée d'un coup (jamais de mélange d'anciens et de nouveaux fichiers) et la
// page affiche « Nouvelle version de l'appli · Afficher ».
// Aucune donnée de planning ne passe ici : elle reste dans le localStorage de la page.
const CACHE = 'mh-app-v96';
const FILES = [
  './', 'index.html', 'app.js', 'core.js', 'team.js', 'style.css', 'xlsx.full.min.js',
  'manifest.json?v=3', 'icon-192.png?v=2', 'icon-512.png?v=2', 'apple-touch-icon.png?v=2',
];
const CHECK_EVERY_MS = 60000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mh-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// pages de l'appli : la racine et index.html (avec ou sans ?notif=1) ; tout autre fichier du site
// (ex. notif/worker.js) va au réseau, sinon le téléphone afficherait l'appli à la place
function isAppPage(url) {
  const path = new URL(url).pathname, scope = new URL(self.registration.scope).pathname;
  return path === scope || path === scope + 'index.html';
}
function fromCache(request) {
  return caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then(hit => {
    if (hit || request.mode !== 'navigate' || !isAppPage(request.url)) return hit;
    return caches.match('./').then(page => page || caches.match('index.html'));
  });
}

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

// Nouvelle version ? On retélécharge tous les fichiers ; si l'un d'eux a changé (et que tout a bien été reçu),
// on remplace toute la copie puis on prévient la page.
let lastCheck = 0, checking = null;
function checkForUpdate() {
  if (checking) return checking;
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return Promise.resolve();
  lastCheck = Date.now();
  checking = (async () => {
    const fresh = await Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'no-cache' }))
      .then(res => { if (!res.ok) throw new Error(res.status); return res; })));
    const cache = await caches.open(CACHE);
    let changed = false;
    for (let i = 0; i < FILES.length && !changed; i++) {
      const old = await cache.match(FILES[i]);
      if (!old) { changed = true; break; }
      const [a, b] = await Promise.all([old.arrayBuffer(), fresh[i].clone().arrayBuffer()]);
      if (!sameBytes(a, b)) changed = true;
    }
    if (!changed) return;
    await Promise.all(FILES.map((f, i) => cache.put(f, fresh[i])));
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    pages.forEach(page => page.postMessage({ type: 'update' }));
  })().catch(() => { /* hors connexion ou fichier manquant : on garde la copie actuelle */ })
    .finally(() => { checking = null; });
  return checking;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate' && !isAppPage(request.url)) return; // autre page du site : directement au réseau
  if (request.mode === 'navigate') event.waitUntil(checkForUpdate());
  event.respondWith(fromCache(request).then(hit => hit || fetch(request, { cache: 'no-cache' }).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return res;
  }).catch(() => Response.error())));
});

// la page le demande quand on revient sur l'appli restée ouverte en arrière-plan
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'check') event.waitUntil(checkForUpdate());
});

// Notifications : « nouveau planning en ligne » (envoyées par le relais, voir notif/worker.js)
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Planning COA', {
    body: data.body || 'Nouveau planning en ligne.', icon: 'icon-192.png?v=2', badge: 'icon-192.png?v=2', tag: 'planning', renotify: true,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(pages => {
    const page = pages.find(p => p.url.startsWith(self.registration.scope));
    if (page) { page.postMessage({ type: 'check-team' }); return page.focus(); }
    return self.clients.openWindow('./?notif=1');
  }));
});
