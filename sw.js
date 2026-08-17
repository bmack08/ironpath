/* IRONPATH service worker — cache-first app shell so the app works
   with zero connectivity once installed. Bump VERSION to ship updates. */

const VERSION = 'ironpath-v7';
const META_CACHE = 'ironpath-meta';   // survives version bumps — reminder state lives here
const SHELL = [
  './',
  'index.html',
  'style.css',
  'fonts.css',
  'data.js',
  'app.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== VERSION && k !== META_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- training-day reminders (periodic background sync) ---------- */

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'ironpath-reminder') e.waitUntil(checkAndNotify());
});

async function checkAndNotify() {
  try {
    const cache = await caches.open(META_CACHE);
    const res = await cache.match('meta');
    if (!res) return;
    const meta = await res.json();
    if (!meta.remindersOn || !meta.last) return;
    const hrs = (Date.now() - meta.last) / 3600000;
    // at most one nudge per ~20h so it never becomes spam
    if (meta.lastNotified && Date.now() - meta.lastNotified < 20 * 3600000) return;

    let title = null, body = '';
    if (hrs >= 68) {
      title = '🔥 Streak on the line';
      body = `${Math.round(hrs)}h since your last session. One 30-minute session tonight keeps the streak alive.`;
    } else if (hrs >= 44) {
      title = `Session ${meta.nextDay} tonight`;
      body = `~48h since your last session — the recovery window is closing. Day ${meta.nextDay} · ${meta.nextName} is up.`;
    }
    if (!title) return;

    meta.lastNotified = Date.now();
    await cache.put('meta', new Response(JSON.stringify(meta)));
    await self.registration.showNotification(title, {
      body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'ironpath-reminder',
    });
  } catch { /* never let a reminder failure break the SW */ }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((ws) => (ws.length ? ws[0].focus() : clients.openWindow('./')))
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // never cache the state API — that's live data for the desktop server
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((res) => {
            if (res.ok && url.origin === location.origin) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(e.request, copy));
            }
            return res;
          })
          .catch(() => caches.match('index.html'))
    )
  );
});
