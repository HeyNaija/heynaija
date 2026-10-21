// Push notifications without Google, Mozilla or Apple. The browsers Playwright
// drives cannot subscribe with a real push service, so the page's PushManager is
// replaced by one that hands out an address on a stand-in push service here, on
// 127.0.0.1 (the API sends there only with PUSH_ALLOW_LOOPBACK). The keys are
// real, so what arrives is decrypted as a browser would, and read.
import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserContext } from '@playwright/test'

export type PushMessage = { title: string; body: string; url: string; tag: string }

/** A browser's half of a subscription: its key pair and auth secret, and the address it was given. */
export type FakeSubscription = { endpoint: string; p256dh: string; auth: string; decrypt(body: Buffer): PushMessage }

/** A stand-in push service: keeps every message sent to it, by address. */
export async function standInPushService() {
  const received: { path: string; body: Buffer }[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      received.push({ path: req.url ?? '', body: Buffer.concat(chunks) })
      res.writeHead(201).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    /** A new subscription on this service, for one browser. */
    subscription(name: string): FakeSubscription {
      const ecdh = createECDH('prime256v1')
      ecdh.generateKeys()
      const auth = randomBytes(16)
      return {
        endpoint: `${origin}/push/${name}-${randomBytes(4).toString('hex')}`,
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: auth.toString('base64url'),
        decrypt: (body) => JSON.parse(decrypt(body, ecdh, auth)) as PushMessage,
      }
    },
    /** What has arrived for `subscription` so far, read. */
    messagesFor(subscription: FakeSubscription): PushMessage[] {
      const path = new URL(subscription.endpoint).pathname
      return received.filter((r) => r.path === path).map((r) => subscription.decrypt(r.body))
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * Lets the browser in `context` show notifications, and gives its PushManager
 * `subscription` to hand out. The subscription lasts across page loads, as a
 * real one does, until it is unsubscribed.
 */
export async function allowPush(context: BrowserContext, baseURL: string, subscription: FakeSubscription) {
  await context.grantPermissions(['notifications'], { origin: baseURL })
  await context.addInitScript(
    ({ endpoint, p256dh, auth }) => {
      // Headless Chromium says "denied" whatever was granted, so the answer is given here too.
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
      Notification.requestPermission = async () => 'granted'
      const STORE = 'e2e-push-subscription'
      const bytes = (base64url: string) =>
        Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')), (c) =>
          c.charCodeAt(0),
        ).buffer
      const text = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
      const make = (serverKey: string) => ({
        endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(serverKey), (c) => c.charCodeAt(0)).buffer },
        getKey: (name: string) => bytes(name === 'p256dh' ? p256dh : auth),
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
        unsubscribe: async () => {
          localStorage.removeItem(STORE)
          return true
        },
      })
      PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
        const key = options?.applicationServerKey as Uint8Array
        localStorage.setItem(STORE, text(key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer))
        return make(localStorage.getItem(STORE)!) as unknown as PushSubscription
      }
      PushManager.prototype.getSubscription = async function () {
        const key = localStorage.getItem(STORE)
        return (key ? make(key) : null) as unknown as PushSubscription | null
      }
    },
    { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
  )
}

/** Waits for the `count`th message to `subscription` to arrive, and returns everything that has. */
export async function waitForPushes(
  service: Awaited<ReturnType<typeof standInPushService>>,
  subscription: FakeSubscription,
  count = 1,
  timeoutMs = 45_000,
): Promise<PushMessage[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const messages = service.messagesFor(subscription)
    if (messages.length >= count) return messages
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no push arrived within ${timeoutMs / 1000}s (is the API running with PUSH_ALLOW_LOOPBACK=true?)`)
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest()

/** aes128gcm (RFC 8188) with Web Push's keys (RFC 8291), one record. */
function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16)
  const idlen = body[20]!
  const serverKey = body.subarray(21, 21 + idlen)
  const record = body.subarray(21 + idlen)
  const ikm = hmac(hmac(auth, ecdh.computeSecret(serverKey)), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey, Buffer.from([1])]))
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(record.subarray(-16))
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()])
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8')
}
