import { z } from 'zod'

export const EMAIL_ADDRESSES = Symbol('EMAIL_ADDRESSES')

/** Where a member's email address can be looked up. */
export interface EmailAddresses {
  /** The address to write to, or null if there is none worth writing to. Throws if it could not be found out. */
  addressFor(memberId: string): Promise<string | null>
}

const identity = z.object({
  state: z.string().optional(),
  traits: z.object({ email: z.string().optional() }),
  verifiable_addresses: z.array(z.object({ value: z.string(), verified: z.boolean() })).optional(),
})

/**
 * Addresses from Kratos, which owns them: nothing here copies an email address
 * into our own database. Asked when an email is about to be sent and never
 * kept, so a changed address is used straight away.
 */
export class KratosAddresses implements EmailAddresses {
  constructor(private readonly adminUrl: string) {}

  async addressFor(memberId: string): Promise<string | null> {
    const res = await fetch(`${this.adminUrl}/admin/identities/${encodeURIComponent(memberId)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.status === 404) return null
    // Trouble on their side is not "no address": the caller retries.
    if (!res.ok) throw new Error(`Kratos answered ${res.status} for an identity`)

    const found = identity.parse(await res.json())
    const email = found.traits.email
    if ((found.state ?? 'active') !== 'active' || !email) return null
    // Only an address the member has proved is theirs: one that was typed in and
    // never confirmed could belong to anybody.
    const proved = found.verifiable_addresses?.some((a) => a.verified && a.value.toLowerCase() === email.toLowerCase())
    return proved ? email : null
  }
}
