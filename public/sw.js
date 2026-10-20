const CACHE_NAME = 'goalpost-shell-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '오늘도골대FC';
  const options = {
    body: payload.body || '새로운 소식이 있습니다.',
    icon: '/manifest.json',
    data: { url: payload.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil((async () => {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 이미 그 글이 열려 있으면 그 창만 앞으로
    const sameClient = clientList.find((client) => client.url === targetUrl && 'focus' in client);
    if (sameClient) return sameClient.focus();

    // 열린 창이 있으면 그 창을 알림 주소로 이동 (서비스워커가 제어하지 않는 창은 navigate가 실패하므로 새 창으로 대체)
    const existingClient = clientList.find((client) => 'focus' in client && 'navigate' in client);
    if (existingClient) {
      try {
        const navigated = await existingClient.navigate(targetUrl);
        if (navigated) return navigated.focus();
      } catch (error) {
        // 아래에서 새 창으로 연다
      }
    }
    return clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});