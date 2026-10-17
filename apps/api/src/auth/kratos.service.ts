import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { z } from 'zod'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { SESSION_CACHE, type SessionCache } from './session-cache.js'

/** Name of the Kratos session cookie (set in infra/kratos/kratos.yml). */
export const SESSION_COOKIE = 'hn_session'

const whoami = z.object({
  active: z.boolean(),
  identity: z.object({
    id: z.uuid(),
    state: z.string().optional(),
    traits: z.object({ handle: z.string(), email: z.string().optional() }),
  }),
})

export type Identity = { id: string; handle: string }

const cachedIdentity = z.object({ id: z.string(), handle: z.string() })

const parseCached = (raw: string | null): Identity | null => {
  if (!raw) return null
  try {
    return cachedIdentity.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

@Injectable()
export class KratosService {
  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'KRATOS_PUBLIC_URL' | 'WHOAMI_CACHE_TTL_S'>,
    @Inject(SESSION_CACHE) private readonly cache: SessionCache,
  ) {}

  /**
   * Who a session cookie belongs to, or null if it is not a live session.
   *
   * Kratos is the authority on sessions, but a page view makes 3–5 API calls and
   * each would otherwise ask Kratos (and Kratos its Postgres) the same question
   * within milliseconds. So a valid answer is reused for WHOAMI_CACHE_TTL_S
   * (30 s by default), keyed by a hash of the cookie (see session-cache.ts).
   *
   * The trade-off: for up to that long, a session Kratos has ended can still be
   * used here. In practice:
   * - Signing out through the web app's /logout drops the entry first, so the
   *   cookie stops working at once (and the browser no longer has it anyway).
   * - Suspension is not affected: the session guard reads `members.active` on
   *   every request, uncached.
   * - A session revoked inside Kratos (admin API, identity deactivated, a
   *   stolen cookie killed elsewhere) keeps working for at most the TTL, and a
   *   handle changed in Kratos shows up within the TTL.
   * Only valid sessions are cached; an unknown cookie always goes to Kratos, so
   * nobody can fill Redis by sending made-up cookies.
   */
  async identityForSession(sessionCookie: string): Promise<Identity | null> {
    // Kratos compares the cookie byte for byte, so it is passed through unencoded;
    // refuse anything that could smuggle a second cookie or header.
    if (!/^[A-Za-z0-9_\-=.~+/%|]+$/.test(sessionCookie)) return null

    const ttl = this.env.WHOAMI_CACHE_TTL_S
    if (ttl > 0) {
      const hit = parseCached(await this.cache.get(sessionCookie))
      if (hit) return hit
    }
    const identity = await this.whoami(sessionCookie)
    if (identity && ttl > 0) await this.cache.set(sessionCookie, JSON.stringify(identity), ttl)
    return identity
  }

  /** Stops reusing a cached answer for this cookie; called when someone signs out. */
  async forgetSession(sessionCookie: string): Promise<void> {
    await this.cache.delete(sessionCookie)
  }

  /**
   * The email address a session's member signs in with, asked of Kratos directly
   * (never cached, unlike the identity above). Null if the session has ended.
   * Only the member's own data export needs it.
   */
  async emailForSession(sessionCookie: string): Promise<string | null> {
    const session = await this.session(sessionCookie)
    return session?.identity.traits.email ?? null
  }

  private async whoami(sessionCookie: string): Promise<Identity | null> {
    const session = await this.session(sessionCookie)
    return session ? { id: session.identity.id, handle: session.identity.traits.handle } : null
  }

  private async session(sessionCookie: string): Promise<z.infer<typeof whoami> | null> {
    let res: Response
    try {
      res = await fetch(`${this.env.KRATOS_PUBLIC_URL}/sessions/whoami`, {
        headers: { cookie: `${SESSION_COOKIE}=${sessionCookie}`, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new ServiceUnavailableException('identity service unreachable')
    }
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) throw new ServiceUnavailableException('identity service error')

    const session = whoami.parse(await res.json())
    if (!session.active || (session.identity.state ?? 'active') !== 'active') return null
    return session
  }
}
