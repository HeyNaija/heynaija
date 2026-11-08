import { createCipheriv, createSign, randomBytes } from 'node:crypto'
import type { Env, FcmServiceAccount } from '../env.js'
import { type AppPushSender, type AppTarget, PermanentPushError, type PushMessage, SubscriptionGoneError } from './push-sender.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
// Google's access tokens last an hour; a new one is asked for a few minutes before.
const RENEW_BEFORE_MS = 5 * 60_000
// As for browsers (push-sender.ts): a day-old notification is old news.
const TTL = '86400s'
const TIMEOUT_MS = 10_000

const b64url = (value: string) => Buffer.from(value).toString('base64url')

/**
 * `text` encrypted with the app's key: a 12-byte nonce, the ciphertext and GCM's
 * 16-byte tag, in base64url. FCM carries it without being able to read it, as a
 * browser's push service does with Web Push.
 */
export function seal(key: string, text: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), nonce)
  return Buffer.concat([nonce, cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url')
}

/** The reason FCM gives for refusing a message, such as UNREGISTERED. */
const fcmErrorCode = (body: unknown): string | undefined => {
  const details = (body as { error?: { details?: { '@type'?: string; errorCode?: string }[] } } | null)?.error?.details
  return Array.isArray(details) ? details.find((d) => d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode : undefined
}

/**
 * Firebase Cloud Messaging's HTTP v1 API, for the Android app (docs/adr/0023).
 * It signs in as the service account with a JWT it signs itself (RFC 7523, as
 * Google's client libraries do), which saves taking on firebase-admin for two
 * requests. Messages are data only, and sealed with the app's key: the app opens
 * them and writes the notification itself, the same way whether it is open or not,
 * and one with the same tag replaces the last.
 */
export class FcmSender implements AppPushSender {
  private access: { token: string; expiresAt: number } | null = null
  private signingIn: Promise<string> | null = null

  constructor(
    private readonly account: FcmServiceAccount,
    private readonly http: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async send(target: AppTarget, message: PushMessage): Promise<void> {
    const res = await this.http(`https://fcm.googleapis.com/v1/projects/${this.account.projectId}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: target.token,
          // With whose notification it is: an app signed out, or signed in as
          // someone else, drops it rather than showing another member's.
          data: { sealed: seal(target.key, JSON.stringify({ ...message, member: target.memberId })) },
          android: { priority: 'HIGH', ttl: TTL },
        },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) {
      await res.body?.cancel()
      return
    }
    const code = fcmErrorCode(await res.json().catch(() => null))
    const what = `FCM answered ${res.status}${code ? ` ${code}` : ''}`
    // The app was removed or signed out of Firebase, or the token is another project's.
    if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') throw new SubscriptionGoneError(what)
    if (res.status === 401) {
      // The access token was refused before its time: the next try signs in again.
      this.access = null
      throw new Error(what)
    }
    // Busy or broken for now: worth another try.
    if (res.status === 429 || res.status >= 500) throw new Error(what)
    // A malformed message or token, a project that is not ours: refused again if sent again.
    throw new PermanentPushError(what)
  }

  /** An access token for FCM, kept until shortly before it runs out. Concurrent sends share one sign-in. */
  private accessToken(): Promise<string> {
    if (this.access && this.now() < this.access.expiresAt - RENEW_BEFORE_MS) return Promise.resolve(this.access.token)
    this.signingIn ??= this.signIn().finally(() => {
      this.signingIn = null
    })
    return this.signingIn
  }

  private async signIn(): Promise<string> {
    const issued = Math.floor(this.now() / 1000)
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({ iss: this.account.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: issued, exp: issued + 3600 }),
    )}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.privateKey, 'base64url')
    const res = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      await res.body?.cancel()
      throw new Error(`Google's token endpoint answered ${res.status}`)
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown }
    if (typeof body.access_token !== 'string') throw new Error('Google gave no access token')
    const lifetimeS = typeof body.expires_in === 'number' ? body.expires_in : 3600
    this.access = { token: body.access_token, expiresAt: this.now() + lifetimeS * 1000 }
    return body.access_token
  }
}

/** A sender for the service account in the environment, or null when none is set: the app is then not offered push. */
export function fcmSender(env: Pick<Env, 'FCM_SERVICE_ACCOUNT'>): AppPushSender | null {
  return env.FCM_SERVICE_ACCOUNT ? new FcmSender(env.FCM_SERVICE_ACCOUNT) : null
}
