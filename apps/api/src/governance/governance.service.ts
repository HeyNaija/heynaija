import {
  ageAssurances,
  type Db,
  governanceAuditLog,
  governanceMemberships,
  identityVerifications,
  profileBadges,
} from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Env } from '../env.js'
import { DB, ENV } from '../tokens.js'
import { type AgeStatus, ageStatus } from './age.js'
import { type ProviderResult, VerificationUnavailableError } from './nin-provider.js'
import {
  badgeAllowed,
  derivePersonKey,
  effectiveVerificationStatus,
  type GovernanceFlags,
  type MembershipGap,
  type MembershipStatus,
  membershipEligibility,
  type VerificationFacts,
  type VerificationStatus,
} from './rules.js'

type GovernanceEnv = GovernanceFlags & Pick<Env, 'IDENTITY_KEY_SECRET'>

/** A member's own governance standing, for Settings. No keys, no provider data. */
export type OwnGovernanceStatus = {
  /** Their own age band and how it is known; never shown to anyone else. */
  age: AgeStatus
  verification: {
    status: VerificationStatus | 'none'
    /** Whether verification can be started at all. False until it is approved. */
    open: boolean
    verifiedAt: Date | null
    expiresAt: Date | null
  }
  badge: { shown: boolean }
  membership: {
    status: MembershipStatus | 'none'
    registrationOpen: boolean
    eligible: boolean
    unmet: MembershipGap[]
  }
}

export type RevocationReason = 'member_withdrew' | 'provider_revoked' | 'fraud' | 'impersonation'

const LIVE = ['pending', 'verified'] as const

// The member's green tick row. Their other badges (Founder) are not this service's.
const identityTick = (memberId: string) =>
  and(eq(profileBadges.memberId, memberId), eq(profileBadges.kind, 'nin_identity_verified'))

/**
 * Reads and writes the restricted age, identity and governance tables. Only
 * statusFor() and recordAgeDeclaration() are reachable from requests today;
 * the rest is the bookkeeping a NINAuth integration would call, built and tested
 * now so the guarantees (one verified account per person, no badge without a
 * reviewed verification, an audit row for every change) live in SQL from the
 * start. Every write leaves a row in restricted.governance_audit_log.
 */
@Injectable()
export class GovernanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: GovernanceEnv,
  ) {}

  /**
   * Records that someone said on /join that they are 18 or older. Called by the
   * Kratos webhook once the account exists (so `memberId` is the new identity);
   * a second call changes nothing. A statement, not a check: it is enough for an
   * account during the beta and never for a vote.
   */
  async recordAgeDeclaration(memberId: string, now = new Date()): Promise<void> {
    await this.db.transaction(async (tx) => {
      const added = await tx
        .insert(ageAssurances)
        .values({ memberId, band: '18_plus', method: 'self_declared', assuredAt: now })
        .onConflictDoNothing({
          target: ageAssurances.memberId,
          where: sql`method = 'self_declared' and withdrawn_at is null`,
        })
        .returning({ id: ageAssurances.id })
      if (added.length) {
        await tx.insert(governanceAuditLog).values({ subjectId: memberId, event: 'age_declared', reason: '18_plus', createdAt: now })
      }
    })
  }

  /** The age an account is treated as having; unknown when nothing is on record. */
  async ageStatusFor(memberId: string, now = new Date()): Promise<AgeStatus> {
    const records = await this.db
      .select({
        band: ageAssurances.band,
        method: ageAssurances.method,
        assuredAt: ageAssurances.assuredAt,
        reviewAfter: ageAssurances.reviewAfter,
        withdrawnAt: ageAssurances.withdrawnAt,
      })
      .from(ageAssurances)
      .where(eq(ageAssurances.memberId, memberId))
    return ageStatus(records, now)
  }

  async statusFor(memberId: string, now = new Date()): Promise<OwnGovernanceStatus> {
    const [age, [verification], [membership], [badge]] = await Promise.all([
      this.ageStatusFor(memberId, now),
      this.latestVerification(memberId),
      this.db
        .select({
          status: governanceMemberships.status,
          optedInAt: governanceMemberships.optedInAt,
          suspendedUntil: governanceMemberships.suspendedUntil,
        })
        .from(governanceMemberships)
        .where(eq(governanceMemberships.memberId, memberId)),
      this.db
        .select({ expiresAt: profileBadges.expiresAt })
        .from(profileBadges)
        .where(identityTick(memberId)),
    ])
    const facts = verification ?? null
    return {
      age,
      verification: {
        status: effectiveVerificationStatus(facts, now),
        open: this.env.NIN_VERIFICATION_ENABLED,
        verifiedAt: facts?.verifiedAt ?? null,
        expiresAt: facts?.expiresAt ?? null,
      },
      badge: {
        shown: Boolean(badge) && badgeAllowed(this.env, facts, now) && (!badge!.expiresAt || badge!.expiresAt > now),
      },
      membership: {
        status: membership?.status ?? 'none',
        registrationOpen: this.env.NIN_VERIFICATION_ENABLED && this.env.BINDING_GOVERNANCE_VOTING_ENABLED,
        // There is no legal association admission register yet. An account or
        // governance_memberships row is not proof of legal membership (v0.3).
        ...membershipEligibility({ flags: this.env, verification: facts, age, membership: membership ?? null, legalMembership: null, now }),
      },
    }
  }

  /**
   * Stores the outcome of a completed provider check. Any earlier live
   * verification of the member is superseded. If another account already holds
   * a verification for the same person, this one is recorded as rejected
   * (duplicate_person) for review and appeal, and the earlier account keeps its.
   * An age result from the same check goes into age_assurances as a separate,
   * verified statement linked to this verification.
   */
  async recordVerification(
    memberId: string,
    result: ProviderResult,
    consent: { version: string; at: Date },
    now = new Date(),
  ): Promise<'verified' | 'rejected'> {
    if (!this.env.NIN_VERIFICATION_ENABLED) throw new VerificationUnavailableError()
    let personKey: string | null = null
    if (result.subject) {
      if (!this.env.IDENTITY_KEY_SECRET) throw new Error('IDENTITY_KEY_SECRET is required to record a verification')
      personKey = derivePersonKey(this.env.IDENTITY_KEY_SECRET, result.provider, result.subject)
    }
    return this.db.transaction(async (tx) => {
      const superseded = await tx
        .update(identityVerifications)
        .set({ status: 'expired', outcome: 'superseded' })
        .where(and(eq(identityVerifications.memberId, memberId), inArray(identityVerifications.status, LIVE)))
        .returning({ id: identityVerifications.id })
      if (superseded.length) await tx.delete(profileBadges).where(identityTick(memberId))

      const row = {
        memberId,
        provider: result.provider,
        personKey,
        consentVersion: consent.version,
        consentedAt: consent.at,
        createdAt: now,
      }
      const [verified] = await tx
        .insert(identityVerifications)
        .values({ ...row, status: 'verified', verifiedAt: result.verifiedAt, expiresAt: result.expiresAt })
        .onConflictDoNothing({
          target: [identityVerifications.provider, identityVerifications.personKey],
          where: sql`status = 'verified' and person_key is not null`,
        })
        .returning({ id: identityVerifications.id })
      if (verified) {
        await tx.insert(governanceAuditLog).values({ subjectId: memberId, event: 'verification_recorded', reason: result.provider, createdAt: now })
        if (result.over18 !== null) {
          const band = result.over18 ? '18_plus' : 'under_18'
          await tx.insert(ageAssurances).values({ memberId, band, method: 'identity_provider', verificationId: verified.id, assuredAt: now })
          await tx.insert(governanceAuditLog).values({ subjectId: memberId, event: 'age_recorded', reason: band, createdAt: now })
        }
        return 'verified'
      }
      await tx.insert(identityVerifications).values({ ...row, status: 'rejected', outcome: 'duplicate_person' })
      await tx.insert(governanceAuditLog).values({ subjectId: memberId, event: 'verification_rejected', reason: 'duplicate_person', createdAt: now })
      return 'rejected'
    })
  }

  /** A person on the team confirms a verification before any public badge. */
  async reviewVerification(memberId: string, reviewerId: string, now = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const reviewed = await tx
        .update(identityVerifications)
        .set({ reviewedAt: now, reviewedBy: reviewerId })
        .where(
          and(
            eq(identityVerifications.memberId, memberId),
            eq(identityVerifications.status, 'verified'),
            sql`${identityVerifications.reviewedAt} is null`,
          ),
        )
        .returning({ id: identityVerifications.id })
      if (!reviewed.length) return false
      await tx.insert(governanceAuditLog).values({ subjectId: memberId, actorId: reviewerId, event: 'verification_reviewed', createdAt: now })
      return true
    })
  }

  /**
   * Ends a live verification: the member withdrew it, the provider revoked it,
   * or it was obtained by fraud. The public badge goes at once, and any age
   * result that came from it stops counting. `actorId` is null when the provider
   * or the member's own request did it.
   */
  async revokeVerification(memberId: string, actorId: string | null, reason: RevocationReason, now = new Date()): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(identityVerifications)
        .set({ status: 'revoked', revokedAt: now, outcome: reason })
        .where(and(eq(identityVerifications.memberId, memberId), inArray(identityVerifications.status, LIVE)))
        .returning({ id: identityVerifications.id })
      if (!revoked.length) return false
      await tx.delete(profileBadges).where(identityTick(memberId))
      await tx.insert(governanceAuditLog).values({ subjectId: memberId, actorId, event: 'verification_revoked', reason, createdAt: now })
      const withdrawn = await tx
        .update(ageAssurances)
        .set({ withdrawnAt: now })
        .where(
          and(
            inArray(ageAssurances.verificationId, revoked.map((r) => r.id)),
            isNull(ageAssurances.withdrawnAt),
          ),
        )
        .returning({ id: ageAssurances.id })
      if (withdrawn.length) {
        await tx.insert(governanceAuditLog).values({ subjectId: memberId, actorId, event: 'age_withdrawn', reason, createdAt: now })
      }
      return true
    })
  }

  /**
   * Shows or hides the member's green tick. Showing it only works while
   * badgeAllowed() holds; returns whether the badge is now shown.
   */
  async setBadgeVisible(memberId: string, visible: boolean, now = new Date()): Promise<boolean> {
    if (!visible) {
      const hidden = await this.db
        .delete(profileBadges)
        .where(identityTick(memberId))
        .returning({ memberId: profileBadges.memberId })
      if (hidden.length) {
        await this.db.insert(governanceAuditLog).values({ subjectId: memberId, actorId: memberId, event: 'badge_hidden', createdAt: now })
      }
      return false
    }
    const [verification] = await this.latestVerification(memberId)
    if (!badgeAllowed(this.env, verification ?? null, now)) return false
    await this.db.transaction(async (tx) => {
      await tx
        .insert(profileBadges)
        .values({ memberId, kind: 'nin_identity_verified', grantedAt: now, expiresAt: verification!.expiresAt })
        .onConflictDoUpdate({
          target: [profileBadges.memberId, profileBadges.kind],
          set: { grantedAt: now, expiresAt: verification!.expiresAt },
        })
      await tx.insert(governanceAuditLog).values({ subjectId: memberId, actorId: memberId, event: 'badge_shown', createdAt: now })
    })
    return true
  }

  /** The member's newest verification row: the live one if there is one. */
  private latestVerification(memberId: string): Promise<VerificationFacts[]> {
    return this.db
      .select({
        status: identityVerifications.status,
        verifiedAt: identityVerifications.verifiedAt,
        expiresAt: identityVerifications.expiresAt,
        reviewedAt: identityVerifications.reviewedAt,
        personKey: identityVerifications.personKey,
      })
      .from(identityVerifications)
      .where(eq(identityVerifications.memberId, memberId))
      .orderBy(desc(identityVerifications.createdAt))
      .limit(1)
  }
}
