import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { z } from 'zod'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'

/** Name of the Kratos session cookie (set in infra/kratos/kratos.yml). */
export const SESSION_COOKIE = 'hn_session'

const whoami = z.object({
  active: z.boolean(),
  identity: z.object({
    id: z.uuid(),
    state: z.string().optional(),
    traits: z.object({ handle: z.string() }),
  }),
})

export type Identity = { id: string; handle: string }

@Injectable()
export class KratosService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Asks Kratos who a session cookie belongs to. Kratos is the only authority on
   * sessions: nothing about them is stored or cached on our side.
   */
  async identityForSession(sessionCookie: string): Promise<Identity | null> {
    // Kratos compares the cookie byte for byte, so it is passed through unencoded;
    // refuse anything that could smuggle a second cookie or header.
    if (!/^[A-Za-z0-9_\-=.~+/%|]+$/.test(sessionCookie)) return null

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
    return { id: session.identity.id, handle: session.identity.traits.handle }
  }
}
