const CACHE_NAME = 'karanlik-oda-v2.3';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './js/app.js',
    './js/editor.js',
    './js/presets.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('📦 Kritik yerel dosyalar önbelleğe alınıyor...');
            // Önce kendi yerel dosyalarımızı kesin olarak önbelleğe alıyoruz
            await cache.addAll(ASSETS);
            
            // Harici Tailwind CDN'ini hata fırlatıp sistemi çökertmeyecek şekilde esnek ekliyoruz
            try {
                const tailwindRequest = new Request('https://cdn.tailwindcss.com', { mode: 'cors' });
                await cache.add(tailwindRequest);
                console.log('🎨 Tailwind CDN başarıyla önbelleklendi.');
            } catch (err) {
                console.warn('⚠️ Tailwind önbelleğe alınamadı ama yerel sistem aktif:', err);
            }
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