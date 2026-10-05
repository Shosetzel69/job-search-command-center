const JSCC_SW_VERSION = 'mobile-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Mobile V1 is deliberately network-only. No API or business payload is cached.
self.addEventListener('fetch', () => {
  // Intentionally no respondWith(): normal network semantics remain authoritative.
});
