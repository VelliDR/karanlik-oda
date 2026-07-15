const CACHE_NAME = 'karanlik-oda-v2.0';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './js/app.js',
    './js/editor.js',
    './js/presets.js',
    'https://cdn.tailwindcss.com' // Tasarımın dağda çökmemesi için önbelleğe alındı
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('📦 Karanlık oda önbelleğe alınıyor...');
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const isLocal = e.request.url.startsWith(self.location.origin);
    const isTailwind = e.request.url.startsWith('https://cdn.tailwindcss.com');

    if (e.request.method !== 'GET' || (!isLocal && !isTailwind)) return;

    e.respondWith(
        caches.match(e.request).then(cached => {
            return cached || fetch(e.request);
        })
    );
});