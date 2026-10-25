// HeyNaija's service worker: it shows push notifications and opens what they are
// about (docs/adr/0011). It does nothing else: no caching, no offline pages, and
// no fetch handler, so every request goes to the network exactly as without it.
// Registered when a member turns push on, in Settings, the welcome flow or the
// installed app's home page (app/ui/push-device.ts).

// A new version takes over at once rather than after every tab has closed.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// What the API sends (apps/api/src/push/push-sender.ts, PushMessage): a title, a
// line of text, a path on this site, and a tag. A notification with the same tag
// replaces the one already on screen, quietly.
self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    // Not ours, or damaged: still show something, as browsers require.
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'HeyNaija', {
      body: message.body || '',
      tag: message.tag || undefined,
      data: { url: message.url || '/notifications' },
      icon: '/icons/icon-192.png',
      // Android draws this in the status bar, as a silhouette.
      badge: '/icons/badge-96.png',
      lang: 'en',
    }),
  )
})

// Tapping a notification opens what it is about: in a HeyNaija tab that is
// already open if there is one, otherwise in a new one. Only paths on this site.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const asked = new URL(event.notification.data?.url || '/notifications', self.location.origin)
  const url = asked.origin === self.location.origin ? asked.href : new URL('/notifications', self.location.origin).href
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const tab of tabs) {
        try {
          // Only a tab this worker controls can be sent somewhere; others are skipped.
          const moved = await tab.navigate(url)
          if (moved) return moved.focus()
        } catch {}
      }
      return self.clients.openWindow(url)
    })(),
  )
})

// A push service can replace a browser's address. Tell the API, so that pushes
// keep reaching it; the request carries the member's session like any other.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription
      const next = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)))
      if (!next) return
      await fetch('/api/v1/push/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...next.toJSON(), replaces: old ? old.endpoint : undefined }),
      })
    })(),
  )
})
