// sw.js — Service Worker (Offline-Cache), Mechanik wie coop-number-sums:
// App-Shell cache-first mit Navigations-Fallback auf index.html, gleich-origin
// GET-Assets stale-while-revalidate, Fremd-Origin (api.anthropic.com) wird
// durchgereicht. Precache EINZELN (Promise.allSettled) + atomarer Swap.
// Cache-Version bumpt build.js pro Release. JEDES neue js/-Modul MUSS in ASSETS.
const CACHE = 'grocery-share-v0.17';
const ASSETS = [
  './index.html',
  './css/styles.css',
  './js/vue.esm-browser.prod.js',
  './js/config.js',
  './js/storage.js',
  './js/receipt.js',
  './js/rules.js',
  './js/attachments.js',
  './js/cost.js',
  './js/claude.js',
  './js/debuglog.js',
  './js/icons.js',
  './js/buildinfo.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const SHELL = './index.html';

// Install: Assets einzeln cachen — schlägt eine Datei fehl, bleibt der Rest im
// Cache. Kein skipWaiting: die App stößt das Update kontrolliert an.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map((a) => cache.add(a)));
  })());
});

// Activate: alte Caches erst löschen, wenn der neue die Shell hat (atomarer
// Swap — kein Aussperren nach misslungenem Update).
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const shell = await cache.match(SHELL);
    if (shell) {
      const keys = await caches.keys();
      // INBOX ausnehmen: dort können geteilte Dateien liegen, die die App noch
      // nicht abgeholt hat (Update genau zwischen Teilen und Öffnen).
      await Promise.all(keys.filter((k) => k !== CACHE && k !== INBOX).map((k) => caches.delete(k)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// Share-Target: geteilte Dateien landen als POST hier. Sie werden in einem
// eigenen Cache („Posteingang") zwischengelagert und die App per Redirect mit
// ?share=1 geöffnet — die holt sie dort ab (js/app.js, pickUpSharedFiles).
// Der POST-Body überlebt keinen Redirect, deshalb dieser Umweg.
const INBOX = 'grocery-share-inbox';

async function stashSharedFiles(request) {
  const form = await request.formData();
  const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size);
  const cache = await caches.open(INBOX);
  // alten Posteingang leeren, damit nie zwei Teilen-Vorgänge vermischt werden
  await Promise.all((await cache.keys()).map((k) => cache.delete(k)));
  await Promise.all(files.map((file, i) => cache.put(
    new Request(`./__shared/${i}`),
    new Response(file, {
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-shared-name': encodeURIComponent(file.name || `bon-${i + 1}`),
      },
    })
  )));
  return files.length;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      let count = 0;
      try {
        count = await stashSharedFiles(e.request);
      } catch { /* kaputte Freigabe → App trotzdem öffnen, ohne Dateien */ }
      return Response.redirect(new URL(`./index.html?share=${count}`, self.registration.scope).href, 303);
    })());
    return;
  }

  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API-Calls etc. durchreichen

  // Navigations-Anfragen offline aus der Shell bedienen.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        const cache = await caches.open(CACHE);
        cache.put(SHELL, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(SHELL)) || Response.error();
      }
    })());
    return;
  }

  // Gleich-Origin-Assets: stale-while-revalidate.
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    const network = fetch(e.request).then(async (res) => {
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
