// Ancienne adresse de la Boîte à outils (déplacée vers /Outil-COA/) : ce worker se retire et efface sa copie.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('coa-outils')).map(x => caches.delete(x))))
    .then(() => self.registration.unregister()));
});
