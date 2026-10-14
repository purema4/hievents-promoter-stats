// Version is filled in by the server so a new release replaces the cached files.
const CACHE = 'promoter-stats-__VERSION__';
const STATIC = ['/offline', '/app.css?v=__CSS_VERSION__', '/app.js', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages hold personal sales data: always from the network, never stored. Offline shows a notice instead.
  if (request.mode === 'navigate') {
    // A connection that hangs (weak mobile signal) shows the notice too, instead of spinning forever.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000));
    event.respondWith(Promise.race([fetch(request), timeout]).catch(() => caches.match('/offline')));
    return;
  }
  if (STATIC.includes(url.pathname + url.search) || url.pathname.startsWith('/icon')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

// Phone notifications: show them, keep the app icon badge in step, and open the right page on tap.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const title = data.title || 'New notification';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/icon-192.png',
        // Android draws the small status-bar icon from the transparent shape only, so it needs an outline.
        badge: '/badge-96.png',
        data: { url: data.url || '/notifications' },
      }),
      'setAppBadge' in self.navigator && data.unread ? self.navigator.setAppBadge(data.unread).catch(() => {}) : null,
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      return open ? open.navigate(url).then((w) => w && w.focus()) : self.clients.openWindow(url);
    }),
  );
});
