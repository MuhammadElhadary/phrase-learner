// Phrase Learner service worker — offline-first cache
const CACHE = 'phrase-learner-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/main.js',
  './js/db.js',
  './js/auth.js',
  './js/sync.js',
  './js/srs.js',
  './js/quiz.js',
  './js/views.js',
  './assets/phrases.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Network-first for Supabase API; cache-first for app shell
  if (url.hostname.endsWith('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      if (res && res.status === 200 && e.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
