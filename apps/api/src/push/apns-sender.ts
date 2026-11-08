import { createHmac } from 'node:crypto'
import { type ClientHttp2Session, connect, constants } from 'node:http2'
import type { PushDeviceService } from '@heynaija/db'
import { appleJwt } from '../apple/apple-jwt.js'
import { type AppleKey, appleKey, type Env } from '../env.js'
import { seal } from './fcm-sender.js'
import { type AppPushSender, type AppTarget, PermanentPushError, type PushMessage, SubscriptionGoneError } from './push-sender.js'

// App Store and TestFlight builds get their tokens from Apple's production service;
// builds run from Xcode from its sandbox. The app says which (docs/adr/0026).
const ORIGINS: Partial<Record<PushDeviceService, string>> = {
  apns: 'https://api.push.apple.com',
  apns_sandbox: 'https://api.sandbox.push.apple.com',
}
// Apple refuses a provider token over an hour old, and one renewed more often than
// every 20 minutes.
const RENEW_AFTER_MS = 40 * 60_000
// As for browsers and FCM: a day-old notification is old news.
const TTL_S = 24 * 60 * 60
const TIMEOUT_MS = 10_000

/** One POST to APNs and its answer. */
export type ApnsTransport = (url: string, headers: Record<string, string>, body: string) => Promise<{ status: number; body: string }>

/**
 * Apple Push Notification service, for the iOS app (docs/adr/0026). It signs in
 * with a provider token, a JWT signed with HeyNaija's Apple key, kept for 40
 * minutes. As with FCM, what Apple carries is sealed with the app's key: the
 * visible alert is only "You have a new notification", which the app's
 * notification service extension replaces with what it opens, before it is shown.
 * One with the same tag replaces the last, through a collapse ID made from the tag
 * and the app's key, so Apple cannot read the tag either.
 */
export class ApnsSender implements AppPushSender {
  readonly services = ['apns', 'apns_sandbox'] as const
  private provider: { jwt: string; madeAt: number } | null = null

  constructor(
    private readonly key: AppleKey,
    private readonly transport: ApnsTransport = http2Transport(),
    private readonly now: () => number = Date.now,
  ) {}

  async send(target: AppTarget, message: PushMessage): Promise<void> {
    const origin = ORIGINS[target.service]
    if (!origin) throw new PermanentPushError(`APNs does not deliver to ${target.service}`)
    const res = await this.transport(
      `${origin}/3/device/${encodeURIComponent(target.token)}`,
      {
        authorization: `bearer ${this.providerToken()}`,
        'apns-topic': this.key.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(this.now() / 1000) + TTL_S),
        'apns-collapse-id': createHmac('sha256', Buffer.from(target.key, 'base64url')).update(message.tag).digest('base64url'),
        'content-type': 'application/json',
      },
      JSON.stringify({
        aps: {
          // Shown only if the extension cannot open `sealed` in time.
          alert: { title: 'HeyNaija', body: 'You have a new notification.' },
          'mutable-content': 1,
          sound: 'default',
        },
        // With whose notification it is, as for FCM: an app signed in as someone else shows nothing of it.
        sealed: seal(target.key, JSON.stringify({ ...message, member: target.memberId })),
      }),
    )
    if (res.status === 200) return
    const reason = apnsReason(res.body)
    const what = `APNs answered ${res.status}${reason ? ` ${reason}` : ''}`
    // The app was removed, or the token is another app's or the other service's.
    if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') throw new SubscriptionGoneError(what)
    if (reason === 'ExpiredProviderToken') {
      // Refused before its time (the clock moved): the next try signs a new one.
      this.provider = null
      throw new Error(what)
    }
    // Busy or broken for now: worth another try.
    if (res.status === 429 || res.status >= 500) throw new Error(what)
    // A wrong key, team or bundle ID, or a malformed message: refused again if sent again.
    if (res.status === 403) this.provider = null
    throw new PermanentPushError(what)
  }

  private providerToken(): string {
    const now = this.now()
    if (!this.provider || now - this.provider.madeAt >= RENEW_AFTER_MS) this.provider = { jwt: appleJwt(this.key, {}, now), madeAt: now }
    return this.provider.jwt
  }
}

/** The reason APNs gives for refusing a notification, such as Unregistered. */
const apnsReason = (body: string): string | undefined => {
  try {
    const reason = (JSON.parse(body) as { reason?: unknown } | null)?.reason
    return typeof reason === 'string' ? reason : undefined
  } catch {
    return undefined
  }
}

/**
 * APNs speaks only HTTP/2, which fetch does not, so this keeps one connection per
 * service with node:http2, as Apple asks, and opens another when one closes. A
 * connection does not keep the process alive while nothing is being sent.
 */
export function http2Transport(): ApnsTransport {
  const sessions = new Map<string, ClientHttp2Session>()
  let sending = 0

  const sessionFor = (origin: string): ClientHttp2Session => {
    const open = sessions.get(origin)
    if (open && !open.closed && !open.destroyed) return open
    const session = connect(origin)
    const forget = () => {
      if (sessions.get(origin) === session) sessions.delete(origin)
    }
    // Apple closes idle connections; a broken one is replaced on the next send.
    session.on('error', forget)
    session.on('goaway', forget)
    session.on('close', forget)
    if (!sending) session.unref()
    sessions.set(origin, session)
    return session
  }

  return (url, headers, body) =>
    new Promise((resolve, reject) => {
      const { origin, pathname } = new URL(url)
      let session: ClientHttp2Session
      try {
        session = sessionFor(origin)
      } catch (error) {
        reject(error)
        return
      }
      sending++
      session.ref()
      const done = () => {
        sending--
        if (!sending) for (const s of sessions.values()) s.unref()
      }
      const req = session.request({ ':method': 'POST', ':path': pathname, ...headers })
      let status = 0
      const chunks: Buffer[] = []
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        done()
        fn()
      }
      req.setTimeout(TIMEOUT_MS, () => req.close(constants.NGHTTP2_CANCEL))
      req.on('response', (h) => {
        status = Number(h[':status'])
      })
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => settle(() => resolve({ status, body: Buffer.concat(chunks).toString('utf8') })))
      req.on('error', (error) => settle(() => reject(error)))
      req.on('close', () => settle(() => reject(new Error('APNs closed the request without answering'))))
      req.end(body)
    })
}

/** A sender for the Apple key in the environment, or null when none is set: the iOS app is then not offered push. */
export function apnsSender(env: Pick<Env, 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY' | 'APPLE_BUNDLE_ID'>): AppPushSender | null {
  const key = appleKey(env)
  return key ? new ApnsSender(key) : null
}
