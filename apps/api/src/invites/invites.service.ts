import { createHash, randomInt } from 'node:crypto'
import { type Db, inviteRedemptions, invites } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { DB } from '../tokens.js'

// Crockford base32: no I, L, O or U, so codes survive being read out or retyped.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** "hn-7k2m 9xq4-w3ep" and "HN7K2M9XQ4W3EP" are the same code. */
export const normaliseInviteCode = (code: string): string =>
  code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')

const hashCode = (code: string): string =>
  createHash('sha256').update(normaliseInviteCode(code)).digest('hex')

export type NewInvite = { maxUses?: number; expiresAt?: Date | null; note?: string | null }

@Injectable()
export class InvitesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Returns the code. It is shown once; only its hash is stored. */
  async create({ maxUses = 1, expiresAt = null, note = null }: NewInvite = {}): Promise<string> {
    // 12 symbols of 5 bits = 60 bits of entropy.
    const body = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    const code = `HN-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`
    await this.db.insert(invites).values({ codeHash: hashCode(code), maxUses, expiresAt, note })
    return code
  }

  private usable(codeHash: string) {
    return and(
      eq(invites.codeHash, codeHash),
      isNull(invites.disabledAt),
      or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
      lt(invites.usedCount, invites.maxUses),
    )
  }

  /** Whether a code could be spent right now. Does not spend it. */
  async isUsable(code: string): Promise<boolean> {
    if (!normaliseInviteCode(code)) return false
    const rows = await this.db
      .select({ codeHash: invites.codeHash })
      .from(invites)
      .where(this.usable(hashCode(code)))
    return rows.length > 0
  }

  /**
   * Spends one use of an invite for a newly created identity. Safe to call again
   * for the same identity, and safe under concurrent signups: the conditional
   * UPDATE is what decides who gets the last use.
   */
  async redeem(code: string, identityId: string): Promise<boolean> {
    if (!normaliseInviteCode(code)) return false
    const codeHash = hashCode(code)

    return this.db.transaction(async (tx) => {
      const [already] = await tx
        .select()
        .from(inviteRedemptions)
        .where(eq(inviteRedemptions.identityId, identityId))
      if (already) return true

      const spent = await tx
        .update(invites)
        .set({ usedCount: sql`${invites.usedCount} + 1` })
        .where(this.usable(codeHash))
        .returning({ codeHash: invites.codeHash })
      if (spent.length === 0) return false

      await tx.insert(inviteRedemptions).values({ identityId, codeHash })
      return true
    })
  }

  /** Whether this identity came in through an invite. */
  async hasRedeemed(identityId: string): Promise<boolean> {
    const rows = await this.db
      .select({ identityId: inviteRedemptions.identityId })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.identityId, identityId))
    return rows.length > 0
  }
}
