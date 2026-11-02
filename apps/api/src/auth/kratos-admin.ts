import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { AuthProviderError } from './auth-session.provider.js'

const identities = z.array(z.object({ id: z.uuid(), traits: z.object({ email: z.string().optional() }) }))

/**
 * Kratos's admin API (KRATOS_ADMIN_URL, on the private network only), for what
 * deleting an account needs (docs/adr/0016): ending a member's sessions,
 * deleting their identity, and finding an account by email for an operator.
 * Behind AuthService like the rest of Kratos (docs/adr/0012). Nothing is cached.
 */
@Injectable()
export class KratosAdmin {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'KRATOS_ADMIN_URL'>) {}

  /**
   * Ends every session the member has, on every device. Safe to repeat: Kratos
   * answers 404 both when no session is left and when there is no such identity,
   * and either way there is nothing left to end.
   */
  async revokeAllSessions(memberId: string): Promise<void> {
    await this.call('DELETE', `/admin/identities/${encodeURIComponent(memberId)}/sessions`)
  }

  /**
   * Switches the identity off: it can no longer sign in, and KratosAddresses no
   * longer gives its address, so an erase tried again after its last email does
   * not send it twice. Safe to repeat: an identity already gone is a 404.
   */
  async deactivateIdentity(memberId: string): Promise<void> {
    await this.call('PATCH', `/admin/identities/${encodeURIComponent(memberId)}`, [{ op: 'replace', path: '/state', value: 'inactive' }])
  }

  /**
   * Deletes the identity: the email address, the sign-in methods and any session
   * left. Safe to repeat: an identity already gone is a 404.
   */
  async deleteIdentity(memberId: string): Promise<void> {
    await this.call('DELETE', `/admin/identities/${encodeURIComponent(memberId)}`)
  }

  /**
   * The member whose account email is `email`, in any case, or null if there is
   * none. Kratos finds it among sign-in identifiers, which hold handles too, so
   * only an identity whose email it is counts.
   */
  async identityIdByEmail(email: string): Promise<string | null> {
    const wanted = email.trim().toLowerCase()
    const res = await this.call('GET', `/admin/identities?credentials_identifier=${encodeURIComponent(wanted)}`)
    const parsed = identities.safeParse(await res.json().catch(() => null))
    if (!parsed.success) throw new AuthProviderError('protocol')
    const matches = parsed.data.filter((identity) => identity.traits.email?.toLowerCase() === wanted)
    // Kratos keeps sign-in identifiers unique, so two would be an answer to distrust.
    if (matches.length > 1) throw new AuthProviderError('protocol')
    return matches[0]?.id ?? null
  }

  /** A change (DELETE, or PATCH with a JSON Patch `patch`) to an identity that is gone counts as done. */
  private async call(method: 'GET' | 'DELETE' | 'PATCH', path: string, patch?: unknown[]): Promise<Response> {
    let res: Response
    try {
      res = await fetch(`${this.env.KRATOS_ADMIN_URL}${path}`, {
        method,
        headers: patch ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
        body: patch ? JSON.stringify(patch) : undefined,
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new AuthProviderError('unavailable')
    }
    if (res.ok || (method !== 'GET' && res.status === 404)) return res
    throw new AuthProviderError('unavailable')
  }
}
