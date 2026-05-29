// ========================================================
// A2 Economics MCQ Practice - Service Worker
// Provides offline caching with network-first updates
// ========================================================

const CACHE_NAME = 'econ-mcq-v8';
const CORE_ASSET_PATHS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data/questions.js',
  './data/as/questions.js',
  './manifest.json'
];

function getScopeUrl() {
  return new URL(self.registration.scope);
}

function resolveScopeAsset(path) {
  return new URL(path, getScopeUrl()).toString();
}

function isSameScopeRequest(url) {
  return url.origin === getScopeUrl().origin &&
    url.pathname.startsWith(getScopeUrl().pathname);
}

// Install event: pre-cache only core app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const assets = CORE_ASSET_PATHS.map(resolveScopeAsset);
      return cache.addAll(assets).catch((err) => {
        console.warn('SW: Partial cache install', err.message);
      });
    })
  );
  self.skipWaiting();
});

// Activate event: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: Network-First strategy for app assets with offline cache fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (!isSameScopeRequest(requestUrl)) return;

  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then((cached) => {
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          return caches.match(resolveScopeAsset('./index.html'));
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});
