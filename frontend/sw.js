// This is the service worker with the combined offline experience (Offline page + Offline copy of pages)

const CACHE = "pwabuilder-offline-page";

importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

const offlineFallbackPage = "index.html";

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener('install', async (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.add(offlineFallbackPage))
  );
});

if (workbox.navigationPreload.isSupported()) {
  workbox.navigationPreload.enable();
}

workbox.routing.registerRoute(
  new RegExp('/*'),
  new workbox.strategies.StaleWhileRevalidate({
  // new workbox.strategies.CacheFirst({
    cacheName: CACHE,
    plugins: [
      new workbox.expiration.ExpirationPlugin({
        maxAgeSeconds: 7 * 24 * 60 * 60, // cache for 1 days
        maxEntries: 1e3,
        purgeOnQuotaError: true
      })
    ]
  })
);

self.addEventListener('fetch', async (event) => {
  let x = event?.request?.url?.searchParams?.get?.('x');
  const x_req = new Request(`https://x_last`);

  if (x) {
    cache.put(x_req, new Response(JSON.stringify({ x })));
  }

  if (event.request.url.toString().includes('/api/share_target')) {
    const x_res = await cache.match(x_req);

    if (!x && x_res) {
      const x_last = await x_res.json();
      const url = new URL(event.request.url);  // Create a URL object
      url.searchParams.set('x', x_last.x);    // Set the 'x' parameter

      // Create a new Request object with the modified URL
      const new_request = new Request(url.toString(), {
        method: event.request.method,
        headers: event.request.headers,
        mode: event.request.mode,
        credentials: event.request.credentials,
        cache: event.request.cache,
        redirect: event.request.redirect,
        referrer: event.request.referrer,
      });

      event.respondWith(fetch(new_request)); // Use fetch with the new request
      return; // Important: prevent further processing of the original request
    }
  }
  
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloadResp = await event.preloadResponse;

        if (preloadResp) {
          return preloadResp;
        }

        const networkResp = await fetch(event.request);
        return networkResp;
      } catch (error) {

        const cache = await caches.open(CACHE);
        const cachedResp = await cache.match(offlineFallbackPage);
        return cachedResp;
      }
    })());
  }
});