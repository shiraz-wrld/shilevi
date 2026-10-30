/*
 * Shilevi service worker — web push only.
 *
 * It deliberately caches nothing: an offline cache of authenticated pages would serve one account's
 * data to the next person using the device. It only displays a notification the server pushed and
 * opens the deep link the server chose.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Shilevi";
  const body = typeof data.body === "string" ? data.body.slice(0, 240) : "";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/account";
  const tag = typeof data.tag === "string" ? data.tag.slice(0, 80) : undefined;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  const path = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url
    : "/account";
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              await self.clients.openWindow(target);
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
