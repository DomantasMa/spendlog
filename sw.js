/* Kaupa service worker — v3
   KEY CHANGE: a NEW cache name (kaupa-v3) + skipWaiting + clients.claim forces
   this worker to take over immediately and DELETE the old 'spendlog-v2' cache
   that was pinning the app to an old index.html. Navigations are network-first
   with the HTTP cache bypassed, so from now on the freshest app always loads
   when online — updates can never get stuck on a stale version again.
   Push / notification handlers preserved so nudges keep working. */

const CACHE = 'kaupa-v3';
const SHELL = [
  './',
  './index.html',
  './icon-192_1.png',
  './icon-512_1.png',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // Only handle same-origin; let Supabase / OpenAI / fonts go straight to the network.
  if (url.origin !== self.location.origin) return;

  const isNav =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNav) {
    // NETWORK-FIRST, HTTP-cache bypassed: always pull the newest index when online.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(url.pathname + url.search, { cache: 'no-store' });
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('./index.html')) ||
               (await caches.match(req)) ||
               Response.error();
      }
    })());
    return;
  }

  // Other same-origin GETs: stale-while-revalidate (fast, refreshes in the background).
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((resp) => {
      if (resp && resp.ok) {
        caches.open(CACHE).then((c) => c.put(req, resp.clone()));
      }
      return resp;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});

/* ================= push notifications ================= */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; }
  catch (err) { d = { body: event.data ? event.data.text() : '' }; }

  const n = (d && d.notification) ? d.notification : d;
  event.waitUntil(self.registration.showNotification((n && n.title) || 'Kaupa', {
    body: (n && (n.body || n.message)) || '',
    icon: (n && n.icon) || './icon-192_1.png',
    badge: (n && n.badge) || './icon-192_1.png',
    tag: (n && n.tag) || 'kaupa',
    renotify: true,
    data: { url: (n && n.url) || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.focus(); } catch (e) {} return; }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
