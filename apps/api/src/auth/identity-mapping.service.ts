import { type Db, members, providerIdentities } from '@heynaija/db'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DB } from '../tokens.js'

export class IdentityMappingPolicyError extends Error {}

/** Resolves provider subjects without making provider IDs part of social code. */
@Injectable()
export class IdentityMappingService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Compatibility-mode lookup. Existing Kratos members have the same subject
   * and member ID; seeing one without a mapping safely creates that bridge.
   */
  async resolve(providerId: string, subject: string): Promise<string | null> {
    const [mapped] = await this.db
      .select({ memberId: providerIdentities.memberId })
      .from(providerIdentities)
      .where(and(eq(providerIdentities.providerId, providerId), eq(providerIdentities.subject, subject)))
    if (mapped) return mapped.memberId
    if (providerId !== 'kratos') return null

    const [legacy] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, subject))
    if (!legacy) return null
    await this.db.insert(providerIdentities).values({ providerId, subject, memberId: legacy.id }).onConflictDoNothing()
    return legacy.id
  }

  /** Adds a known bridge without changing the member ID. Safe under retries. */
  async ensure(providerId: string, subject: string, memberId: string): Promise<void> {
    const [existing] = await this.db
      .select({ memberId: providerIdentities.memberId })
      .from(providerIdentities)
      .where(and(eq(providerIdentities.providerId, providerId), eq(providerIdentities.subject, subject)))
    if (existing) {
      if (existing.memberId !== memberId) throw new ConflictException('authentication identity belongs to another member')
      return
    }
    await this.db.insert(providerIdentities).values({ providerId, subject, memberId }).onConflictDoNothing()
  }

  /** Linking requires explicit product authorization and recent provider auth. */
  async link(memberId: string, providerId: string, subject: string, policy: { explicit: true; reauthenticated: true }): Promise<void> {
    if (!policy.explicit || !policy.reauthenticated) throw new IdentityMappingPolicyError('explicit recent authentication is required')
    const [member] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, memberId))
    if (!member) throw new NotFoundException('member not found')
    const [existing] = await this.db
      .select({ memberId: providerIdentities.memberId })
      .from(providerIdentities)
      .where(and(eq(providerIdentities.providerId, providerId), eq(providerIdentities.subject, subject)))
    if (existing && existing.memberId !== memberId) throw new ConflictException('authentication identity belongs to another member')
    await this.db.insert(providerIdentities).values({ providerId, subject, memberId }).onConflictDoNothing()
  }

  /** Never unlink the final identity; email equality is not considered proof. */
  async unlink(memberId: string, providerId: string, subject: string, policy: { explicit: true; reauthenticated: true }): Promise<void> {
    if (!policy.explicit || !policy.reauthenticated) throw new IdentityMappingPolicyError('explicit recent authentication is required')
    const identities = await this.db
      .select({ providerId: providerIdentities.providerId, subject: providerIdentities.subject })
      .from(providerIdentities)
      .where(eq(providerIdentities.memberId, memberId))
    if (identities.length <= 1) throw new IdentityMappingPolicyError('the last authentication identity cannot be unlinked')
    if (!identities.some((identity) => identity.providerId === providerId && identity.subject === subject)) {
      throw new NotFoundException('authentication identity not linked')
    }
    await this.db.delete(providerIdentities).where(and(
      eq(providerIdentities.providerId, providerId),
      eq(providerIdentities.subject, subject),
      eq(providerIdentities.memberId, memberId),
    ))
  }
}
