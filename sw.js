/* ゴルフスコア管理 - Service Worker (オフライン対応) */
const CACHE = 'golf-score-v30';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=26',
  './app.js?v=29',
  './firebase-config.js?v=1',
  './firebase-store.js?v=2',
  './manifest.webmanifest',
  './data.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('golf-score-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 外部API（GitHub等）はキャッシュせずそのままネットワークへ
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/firebase-config.js')) {
    event.respondWith(
      fetch(req).then((response) => {
        if (!response.ok) throw new Error(`Firebase configuration HTTP ${response.status}`);
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
        return response;
      }).catch((error) => caches.match(req).then((cached) => {
        if (cached) return cached;
        throw error;
      }))
    );
    return;
  }

  // 共有データ(data.json)は常にネットワーク優先（最新を取得するため）
  if (url.pathname.endsWith('data.json')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
