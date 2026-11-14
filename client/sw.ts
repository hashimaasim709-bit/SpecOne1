/// <reference lib="webworker" />
// Service worker: installable PWA, offline fallback and fast repeat visits.
// Hashed /assets/* files are immutable, so each deploy gets fresh files automatically (#86).
declare const __BUILD_ID__: string;
declare const __PRECACHE__: string[];
const sw = self as unknown as ServiceWorkerGlobalScope;

const VERSION = __BUILD_ID__;
const STATIC = `s1-static-${VERSION}`;
const PAGES = `s1-pages-${VERSION}`;
const MEDIA = 's1-media-v1';

sw.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    await Promise.all(__PRECACHE__.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)));
    await sw.skipWaiting();
  })());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![STATIC, PAGES, MEDIA].includes(key)) await caches.delete(key);
    await sw.clients.claim();
  })());
});

sw.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void sw.skipWaiting();
  if (event.data === 'clear-private') void caches.delete(PAGES);
});

async function trim(cacheName: string, max: number): Promise<void> {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/docs/') || url.pathname.startsWith('/calendar/') || url.pathname.endsWith('.pdf') || url.pathname.endsWith('.ics')) return;

  // Immutable, content-hashed assets: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then(async (res) => {
      if (res.ok) (await caches.open(STATIC)).put(req, res.clone());
      return res;
    })));
    return;
  }

  // Public media: cache first, only when the server marked it public.
  if (url.pathname.startsWith('/media/')) {
    event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then(async (res) => {
      if (res.ok && res.status === 200 && (res.headers.get('Cache-Control') ?? '').includes('public')) {
        (await caches.open(MEDIA)).put(req, res.clone());
        void trim(MEDIA, 150);
      }
      return res;
    })));
    return;
  }

  // Pages: network first so content is always current, cached copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && !url.pathname.startsWith('/admin')) {
          (await caches.open(PAGES)).put(req, res.clone());
          void trim(PAGES, 40);
        }
        return res;
      } catch {
        return (await caches.match(req)) ?? (await caches.match('/offline')) ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
  }
});
