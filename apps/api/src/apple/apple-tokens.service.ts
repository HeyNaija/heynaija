import { appleTokens, type Db } from '@heynaija/db'
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { type AppleKey, appleKey, type Env } from '../env.js'
import { DB, ENV } from '../tokens.js'
import { appleJwt } from './apple-jwt.js'

const APPLE = 'https://appleid.apple.com'
const TIMEOUT_MS = 10_000
export const APPLE_HTTP = Symbol('APPLE_HTTP')

/** Apple refused the authorization code: used already, more than five minutes old, or another app's. */
export class AppleCodeRefusedError extends Error {}

/**
 * Sign in with Apple's tokens (docs/adr/0026). Apple requires an app that offers
 * it to revoke the member's tokens when their account is deleted. Kratos checks
 * the iOS app's ID token and keeps nothing it could revoke with, so after signing
 * in with Apple the app sends the authorization code Apple gave it with that
 * token; this trades it for a refresh token and keeps that, and erasing the
 * account revokes it. Both calls need HeyNaija's Apple key (APPLE_*).
 */
@Injectable()
export class AppleTokensService {
  private readonly log = new Logger(AppleTokensService.name)
  private readonly key: AppleKey | null
  /** The clock, for tests. */
  now: () => number = Date.now

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) env: Pick<Env, 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY' | 'APPLE_BUNDLE_ID'>,
    @Optional() @Inject(APPLE_HTTP) private readonly http: typeof fetch = fetch,
  ) {
    this.key = appleKey(env)
  }

  /** False without the Apple key: the app's codes are not taken. */
  get enabled(): boolean {
    return this.key !== null
  }

  /** Trades the app's authorization code for a refresh token, kept for the member in place of any earlier one. */
  async keep(memberId: string, code: string): Promise<void> {
    const key = this.key
    if (!key) throw new Error('no Apple key')
    const res = await this.post('/auth/token', { client_id: key.bundleId, client_secret: this.clientSecret(key), code, grant_type: 'authorization_code' })
    const body = (await res.json().catch(() => null)) as { refresh_token?: unknown; error?: unknown } | null
    if (res.status === 400 && body?.error === 'invalid_grant') throw new AppleCodeRefusedError('Apple refused the code')
    if (!res.ok || typeof body?.refresh_token !== 'string') throw new Error(`Apple's token endpoint answered ${res.status}${typeof body?.error === 'string' ? ` ${body.error}` : ''}`)
    const refreshToken = body.refresh_token
    await this.db
      .insert(appleTokens)
      .values({ memberId, refreshToken })
      .onConflictDoUpdate({ target: appleTokens.memberId, set: { refreshToken, createdAt: new Date(this.now()) } })
  }

  /**
   * Revokes the member's token with Apple, then forgets it. Safe to repeat. Throws
   * when Apple cannot be reached, so the erase is tried again; a refusal (a token
   * the member already revoked, or a key that no longer works) is logged and the
   * token forgotten, since trying again would not change it.
   */
  async revokeFor(memberId: string): Promise<void> {
    const [row] = await this.db.select({ refreshToken: appleTokens.refreshToken }).from(appleTokens).where(eq(appleTokens.memberId, memberId))
    if (!row) return
    const key = this.key
    if (!key) {
      this.log.warn(`member ${memberId} signed in with Apple, but without APPLE_* the token cannot be revoked`)
    } else {
      const res = await this.post('/auth/revoke', {
        client_id: key.bundleId,
        client_secret: this.clientSecret(key),
        token: row.refreshToken,
        token_type_hint: 'refresh_token',
      })
      await res.body?.cancel()
      if (res.status === 429 || res.status >= 500) throw new Error(`Apple's revoke endpoint answered ${res.status}`)
      if (!res.ok) this.log.warn(`Apple refused to revoke member ${memberId}'s token (${res.status})`)
    }
    await this.db.delete(appleTokens).where(eq(appleTokens.memberId, memberId))
  }

  /** Sign in with Apple's client secret: a short-lived JWT for the app's bundle ID. */
  private clientSecret(key: AppleKey): string {
    return appleJwt(key, { exp: Math.floor(this.now() / 1000) + 300, aud: APPLE, sub: key.bundleId }, this.now())
  }

  private post(path: string, form: Record<string, string>): Promise<Response> {
    return this.http(`${APPLE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
}
