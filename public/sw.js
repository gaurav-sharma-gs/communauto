self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body } = event.data.payload;
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
      })
    );
  }
});

self.addEventListener('push', event => {
  if (!event.data) return;
  const { title, body } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title || 'CommuneAuto Finder', {
      body: body || 'New notification from CommuneAuto Finder.',
    })
  );
});
