// sw.js — service worker: de app opent ook zonder internet.
// Strategie: geef direct de bewaarde versie en haal op de achtergrond een nieuwe op
// ("stale-while-revalidate"). Een nieuwe versie zie je dus bij de volgende keer openen.
const CACHE = 'esc-ranker';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'ranking.js', 'store.js', 'ui.js', 'player.js',
  'sessions.js', 'group.js', 'list.js', 'songs.json', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Alleen eigen bestanden; audio van iTunes en YouTube gaan gewoon via internet.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request);
    const fresh = fetch(e.request)
      .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => cached);
    return cached || fresh;
  }));
});
