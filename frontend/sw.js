// Service Worker for The Newsroom RSS
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

const CACHE_NAME = 'the-newsroom-rss-v1.16';
const OFFLINE_PAGE = 'index.html';

self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll([
				OFFLINE_PAGE,
				'index.js?v=1.16',
				'index.css?v=1.16',
				'manifest.json',
				'favicon.ico',
				'default-profile-64x64.png',
				'/js/module.mjs',
				'/js/llm.mjs',
				'/js/hclust.mjs'
			]);
		})
	);
});

if (workbox.navigationPreload.isSupported()) {
	workbox.navigationPreload.enable();
}

// 1. Static Assets (JS, CSS) - StaleWhileRevalidate for fast loading + background update
workbox.routing.registerRoute(
	({request}) => request.destination === 'script' || request.destination === 'style',
	new workbox.strategies.StaleWhileRevalidate({
		cacheName: 'static-assets',
		plugins: [
			new workbox.expiration.ExpirationPlugin({
				maxEntries: 50,
				maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
			}),
		],
	})
);

// 2. Images - CacheFirst for performance (rarely change)
workbox.routing.registerRoute(
	({request}) => request.destination === 'image',
	new workbox.strategies.CacheFirst({
		cacheName: 'images',
		plugins: [
			new workbox.expiration.ExpirationPlugin({
				maxEntries: 200,
				maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
				purgeOnQuotaError: true,
			}),
		],
	})
);

// 3. Third-party CDNs - StaleWhileRevalidate
workbox.routing.registerRoute(
	({url}) => url.origin === 'https://cdn.jsdelivr.net' ||
	           url.origin === 'https://unpkg.com' ||
	           url.origin === 'https://accounts.google.com' ||
	           url.origin === 'https://www.googletagmanager.com',
	new workbox.strategies.StaleWhileRevalidate({
		cacheName: 'third-party',
		plugins: [
			new workbox.expiration.ExpirationPlugin({
				maxEntries: 50,
				maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
			}),
		],
	})
);

// 4. API Requests - NetworkFirst to ensure fresh data, but with a short timeout and fallback
workbox.routing.registerRoute(
	({url}) => url.pathname.startsWith('/api/'),
	new workbox.strategies.NetworkFirst({
		cacheName: 'api-responses',
		networkTimeoutSeconds: 5,
		plugins: [
			new workbox.expiration.ExpirationPlugin({
				maxEntries: 100,
				maxAgeSeconds: 15 * 60, // 15 mins
			}),
		],
	})
);

// 5. Navigation - NetworkFirst with Offline Fallback
const navigationStrategy = new workbox.strategies.NetworkFirst({
	cacheName: 'navigations',
	plugins: [
		new workbox.expiration.ExpirationPlugin({
			maxEntries: 20,
			maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
		}),
	],
});

workbox.routing.registerRoute(
	({request}) => request.mode === 'navigate',
	async (params) => {
		try {
			return await navigationStrategy.handle(params);
		} catch (error) {
			return caches.match(OFFLINE_PAGE);
		}
	}
);

// Custom logic for share_target
self.addEventListener('fetch', (event) => {
	if (event.request.url.toString().includes('/api/share_target')) {
		event.respondWith((async () => {
			const cache = await caches.open(CACHE_NAME);
			const x_req = new Request('https://x_last');
			const x_res = await cache.match(x_req);
			const url = new URL(event.request.url);
			const x = url.searchParams.get('x');

			if (x) {
				await cache.put(x_req, new Response(JSON.stringify({x})));
			} else if (x_res) {
				const x_last = await x_res.json();
				url.searchParams.set('x', x_last.x);
				const new_request = new Request(url.toString(), {
					method: event.request.method,
					headers: event.request.headers,
					mode: event.request.mode,
					credentials: event.request.credentials,
					cache: event.request.cache,
					redirect: event.request.redirect,
					referrer: event.request.referrer,
				});
				return fetch(new_request);
			}
			return fetch(event.request);
		})());
	}
});
