import webpush from 'web-push'
import type { Env } from '../env.js'

export const PUSH_SENDER = Symbol('PUSH_SENDER')

/** Where one browser's push notifications go, as the browser gave it. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string }

/**
 * What one push notification shows and where tapping it leads. The service
 * worker (apps/web/public/sw.js) reads exactly this. A newer notification with
 * the same `tag` replaces the one on screen instead of adding another.
 */
export type PushMessage = { title: string; body: string; url: string; tag: string }

/** Somewhere to send push notifications: each browser's push service. */
export interface PushSender {
  /** The key browsers subscribe with (their applicationServerKey), base64url. */
  readonly publicKey: string
  send(target: PushTarget, message: PushMessage): Promise<void>
}

/** The push service no longer knows this address (404 or 410): the browser unsubscribed, or the address expired. */
export class SubscriptionGoneError extends Error {}

/** The push service refused this message for good; sending it again would fail the same way. */
export class PermanentPushError extends Error {}

// The push services browsers subscribe through: Chrome, Edge on Android, Samsung
// Internet, Opera and Brave (Google), Firefox (Mozilla), Safari (Apple) and Edge on
// Windows (Microsoft). A browser hands us an address and the server then sends to
// it, so any other host is refused: otherwise a made-up subscription could aim the
// server at a machine on its own network.
const PUSH_SERVICE_HOSTS = new Set(['fcm.googleapis.com'])
const PUSH_SERVICE_DOMAINS = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']

/**
 * Whether a subscription's address is one of the push services. `loopback` also
 * allows http://127.0.0.1, for the end-to-end tests' stand-in (PUSH_ALLOW_LOOPBACK).
 */
export function isPushServiceUrl(value: string, loopback = false): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (loopback && url.protocol === 'http:' && url.hostname === '127.0.0.1') return true
  if (url.protocol !== 'https:' || url.port) return false
  return PUSH_SERVICE_HOSTS.has(url.hostname) || PUSH_SERVICE_DOMAINS.some((domain) => url.hostname.endsWith(domain))
}

// How long a push service keeps trying a phone that is off or out of signal. A
// notification that has waited a day is old news, and it is in the app anyway.
const TTL_S = 24 * 60 * 60
// Long enough for a slow push service, short enough to free the worker.
const TIMEOUT_MS = 10_000

/**
 * Web Push (RFC 8030) with VAPID (RFC 8292): `web-push` encrypts the message for
 * the browser's keys (RFC 8291) and signs the request; the push service, which
 * cannot read it, passes it to the browser. Sent with fetch rather than
 * `web-push`'s own client, so the time limit, redirects and the answer are ours.
 */
export class WebPushSender implements PushSender {
  constructor(private readonly vapid: { subject: string; publicKey: string; privateKey: string }) {}

  get publicKey(): string {
    return this.vapid.publicKey
  }

  async send(target: PushTarget, message: PushMessage): Promise<void> {
    const request = webpush.generateRequestDetails(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(message),
      { vapidDetails: this.vapid, TTL: TTL_S, contentEncoding: 'aes128gcm' },
    )
    const res = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    await res.body?.cancel()
    if (res.ok) return
    const what = `push service answered ${res.status}`
    if (res.status === 404 || res.status === 410) throw new SubscriptionGoneError(what)
    // Busy or broken for now: worth another try.
    if (res.status === 429 || res.status >= 500) throw new Error(what)
    // A refused key or token, a message too large: the same request would be refused again.
    throw new PermanentPushError(what)
  }
}

/** A sender for the VAPID keys in the environment, or null when none are set: notifications then stay in the app and email. */
export function webPushSender(
  env: Pick<Env, 'PUSH_VAPID_PUBLIC_KEY' | 'PUSH_VAPID_PRIVATE_KEY' | 'PUSH_CONTACT' | 'WEB_PUBLIC_URL'>,
): PushSender | null {
  if (!env.PUSH_VAPID_PUBLIC_KEY || !env.PUSH_VAPID_PRIVATE_KEY) return null
  return new WebPushSender({
    subject: env.PUSH_CONTACT ?? env.WEB_PUBLIC_URL,
    publicKey: env.PUSH_VAPID_PUBLIC_KEY,
    privateKey: env.PUSH_VAPID_PRIVATE_KEY,
  })
}
