import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

// public/sw.js runs in a browser's service worker, which the end-to-end tests
// cannot reach (their push service is a stand-in). Here it runs in a sandbox with
// just enough of a service worker around it to see what it does with each event.
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')

function worker({ tabs = [] } = {}) {
  const listeners = {}
  const shown = []
  const opened = []
  const fetched = []
  const self = {
    location: new URL('https://heynaija.test/sw.js'),
    addEventListener: (type, listener) => (listeners[type] = listener),
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title, options) => shown.push({ title, ...options }),
      pushManager: { subscribe: async () => ({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'p', auth: 'a' } }) }) },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => tabs,
      openWindow: async (url) => opened.push(url),
    },
  }
  vm.runInNewContext(source, { self, URL, JSON, fetch: async (url, init) => fetched.push({ url, ...init }) })
  /** Fires an event and waits for what the worker asked to wait for. */
  const fire = async (type, event) => {
    let waiting = Promise.resolve()
    listeners[type]({ ...event, waitUntil: (promise) => (waiting = promise) })
    await waiting
  }
  return { fire, shown, opened, fetched }
}

const pushEvent = (message) => ({ data: { json: () => message } })

test('a push shows the API’s message, tagged so that the next one about the same post replaces it', async () => {
  const sw = worker()
  await sw.fire('push', pushEvent({ title: '@bayo replied to your post', body: '“Jollof, obviously”', url: '/p/1', tag: 'reply:1' }))
  assert.equal(sw.shown.length, 1)
  assert.equal(sw.shown[0].title, '@bayo replied to your post')
  assert.equal(sw.shown[0].body, '“Jollof, obviously”')
  assert.equal(sw.shown[0].tag, 'reply:1')
  assert.deepEqual({ ...sw.shown[0].data }, { url: '/p/1' })
  assert.equal(sw.shown[0].icon, '/icons/icon-192.png')
  assert.equal(sw.shown[0].badge, '/icons/badge-96.png')
})

test('a push that cannot be read still shows something, as browsers require', async () => {
  const sw = worker()
  await sw.fire('push', { data: { json: () => JSON.parse('not json') } })
  await sw.fire('push', { data: null })
  assert.deepEqual(
    sw.shown.map((n) => [n.title, n.data.url]),
    [
      ['HeyNaija', '/notifications'],
      ['HeyNaija', '/notifications'],
    ],
  )
})

test('tapping a notification opens what it is about, in an open tab if there is one', async () => {
  const navigated = []
  const tab = {
    navigate: async (url) => {
      navigated.push(url)
      return { focus: async () => 'focused' }
    },
  }
  const withTab = worker({ tabs: [tab] })
  const close = () => undefined
  await withTab.fire('notificationclick', { notification: { close, data: { url: '/p/1' } } })
  assert.deepEqual(navigated, ['https://heynaija.test/p/1'])
  assert.deepEqual(withTab.opened, [])

  // A tab this worker does not control cannot be sent anywhere: a new one opens.
  const stuck = worker({ tabs: [{ navigate: async () => Promise.reject(new TypeError('not controlled')) }] })
  await stuck.fire('notificationclick', { notification: { close, data: { url: '/u/chi' } } })
  assert.deepEqual(stuck.opened, ['https://heynaija.test/u/chi'])
})

test('a notification never opens another site', async () => {
  const sw = worker()
  await sw.fire('notificationclick', { notification: { close: () => undefined, data: { url: 'https://evil.test/phish' } } })
  await sw.fire('notificationclick', { notification: { close: () => undefined, data: { url: '//evil.test/phish' } } })
  assert.deepEqual(sw.opened, ['https://heynaija.test/notifications', 'https://heynaija.test/notifications'])
})

test('a new address from the push service is passed to the API, with the one it replaces', async () => {
  const sw = worker()
  await sw.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/old', options: {} } })
  assert.equal(sw.fetched.length, 1)
  assert.equal(sw.fetched[0].url, '/api/v1/push/subscriptions')
  assert.equal(sw.fetched[0].method, 'POST')
  assert.equal(sw.fetched[0].credentials, 'same-origin')
  assert.deepEqual(JSON.parse(sw.fetched[0].body), {
    endpoint: 'https://fcm.googleapis.com/fcm/send/new',
    keys: { p256dh: 'p', auth: 'a' },
    replaces: 'https://fcm.googleapis.com/fcm/send/old',
  })
})
