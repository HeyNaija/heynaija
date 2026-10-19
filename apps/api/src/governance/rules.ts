import { createHmac } from 'node:crypto'
import type { GOVERNANCE_MEMBERSHIP_STATUSES, VERIFICATION_STATUSES } from '@heynaija/db'
import type { Env } from '../env.js'
import { type AgeStatus, isAdultFor } from './age.js'

// The draft constitution's eligibility rules as code, so the server, not the
// browser, decides who could verify, show a badge, join or vote (Annex A: hiding
// buttons is not enforcement). Everything here is pure; GovernanceService reads
// the rows and asks these functions. The numbers are proposals, not adopted
// rules: change them only with the published constitution.

export type GovernanceFlags = Pick<
  Env,
  'NIN_VERIFICATION_ENABLED' | 'BINDING_GOVERNANCE_VOTING_ENABLED' | 'UNDER_18_ACCOUNTS_ENABLED'
>

/** Draft constitution v0.3, Articles 5 and 8. Proposals; features remain locked. */
export const PROPOSED_RULES = {
  eligibilityFreezeDays: 14,
  accountAgeDays: 30,
  minimumElectorate: 100,
} as const

const DAY_MS = 24 * 60 * 60 * 1000

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]
export type MembershipStatus = (typeof GOVERNANCE_MEMBERSHIP_STATUSES)[number]

/** The parts of an identity_verifications row the rules look at. */
export type VerificationFacts = {
  status: VerificationStatus
  verifiedAt: Date | null
  expiresAt: Date | null
  reviewedAt: Date | null
  personKey: string | null
}

export type MembershipFacts = {
  // Online participation only. 'resigned' deactivates online voting and never
  // proves resignation from the legal association.
  status: MembershipStatus
  optedInAt: Date
  suspendedUntil: Date | null
}

/** Future association register facts, separate from platform accounts/opt-in. */
export type LegalMembershipFacts = {
  status: 'admitted' | 'suspended' | 'ended'
  admittedAt: Date
}

/**
 * What a verification counts as now. A 'verified' row past its expiry is
 * expired whether or not a job has rewritten it yet, so nothing waits on a sweep.
 */
export function effectiveVerificationStatus(
  record: VerificationFacts | null,
  now: Date,
): VerificationStatus | 'none' {
  if (!record) return 'none'
  if (record.status === 'verified' && record.expiresAt && record.expiresAt <= now) return 'expired'
  return record.status
}

/**
 * Whether the green "NIN identity verified" tick may be shown for this record:
 * verification is switched on, the record is verified and current, and a person
 * reviewed it. The member must also have chosen to show it (a profile_badges row).
 * Nothing a member types, and no migration default, can make this true.
 */
export function badgeAllowed(flags: GovernanceFlags, record: VerificationFacts | null, now: Date): boolean {
  return (
    flags.NIN_VERIFICATION_ENABLED &&
    effectiveVerificationStatus(record, now) === 'verified' &&
    record!.reviewedAt !== null
  )
}

export type MembershipGap =
  | 'not_legal_member'
  | 'registration_closed'
  | 'not_verified'
  | 'not_reviewed'
  | 'age_not_verified'
  | 'uniqueness_unavailable'
  | 'not_opted_in'
  | 'membership_pending'
  | 'suspended'
  | 'resigned'

/**
 * Whether a member may hold an active voting membership now (Article 2), and
 * every condition they do not meet. Identity verification, a verified adult age
 * and an explicit opt-in are three separate conditions: a stated age is enough
 * for an account, never for a vote, and an unknown age never counts. If the
 * provider gave no stable person key, uniqueness cannot be assured and formal
 * voting stays blocked for them (Annex A).
 */
export function membershipEligibility(input: {
  flags: GovernanceFlags
  verification: VerificationFacts | null
  age: AgeStatus
  membership: MembershipFacts | null
  /** Missing until a lawful admission register exists: always fail closed. */
  legalMembership?: LegalMembershipFacts | null
  now: Date
}): { eligible: boolean; unmet: MembershipGap[] } {
  const { flags, verification, age, membership, legalMembership, now } = input
  const unmet: MembershipGap[] = []
  if (!flags.NIN_VERIFICATION_ENABLED || !flags.BINDING_GOVERNANCE_VOTING_ENABLED) unmet.push('registration_closed')
  if (legalMembership?.status !== 'admitted' || legalMembership.admittedAt > now) unmet.push('not_legal_member')
  if (effectiveVerificationStatus(verification, now) !== 'verified') {
    unmet.push('not_verified')
  } else {
    if (!verification!.reviewedAt) unmet.push('not_reviewed')
    if (!verification!.personKey) unmet.push('uniqueness_unavailable')
  }
  if (!isAdultFor(age, 'governance_vote')) unmet.push('age_not_verified')
  if (!membership) unmet.push('not_opted_in')
  else if (membership.status === 'resigned') unmet.push('resigned')
  else if (membership.status === 'suspended' && (!membership.suspendedUntil || membership.suspendedUntil > now)) {
    unmet.push('suspended')
  } else if (membership.status === 'pending') unmet.push('membership_pending')
  return { eligible: unmet.length === 0, unmet }
}

export type BallotGap = 'not_a_member' | 'account_too_new' | 'joined_after_freeze'

/**
 * Whether an eligible member may vote in a ballot opening at `ballotOpensAt`
 * (Article 5): they were legally admitted, opted in and verified before the list froze 14 days
 * earlier, and their account is at least 30 days old when the ballot opens.
 * People who qualify after the freeze vote in the next ballot.
 */
export function ballotEligibility(input: {
  membershipEligible: boolean
  accountCreatedAt: Date
  optedInAt: Date | null
  verifiedAt: Date | null
  legalAdmittedAt: Date | null
  ballotOpensAt: Date
}): { eligible: boolean; unmet: BallotGap[] } {
  const { membershipEligible, accountCreatedAt, optedInAt, verifiedAt, legalAdmittedAt, ballotOpensAt } = input
  const unmet: BallotGap[] = []
  if (!membershipEligible || !optedInAt || !verifiedAt || !legalAdmittedAt) {
    unmet.push('not_a_member')
  } else {
    const freeze = ballotOpensAt.getTime() - PROPOSED_RULES.eligibilityFreezeDays * DAY_MS
    if (optedInAt.getTime() > freeze || verifiedAt.getTime() > freeze || legalAdmittedAt.getTime() > freeze) unmet.push('joined_after_freeze')
  }
  if (ballotOpensAt.getTime() - accountCreatedAt.getTime() < PROPOSED_RULES.accountAgeDays * DAY_MS) {
    unmet.push('account_too_new')
  }
  return { eligible: unmet.length === 0, unmet }
}

/**
 * Whether a binding ballot may open at all (Article 8). Below the minimum
 * electorate only polls labelled non-binding may run.
 */
export function bindingBallotMayOpen(flags: GovernanceFlags, eligibleVoters: number): boolean {
  return flags.BINDING_GOVERNANCE_VOTING_ENABLED && eligibleVoters >= PROPOSED_RULES.minimumElectorate
}

/**
 * The private key that stops one person verifying two accounts: an HMAC of the
 * provider's pseudonymous identifier under a secret only HeyNaija holds. It is
 * never the NIN or a plain hash of it, and it is still personal data (Article
 * 4.5): keep it in the restricted schema and never return it from an API.
 */
export function derivePersonKey(secret: string, provider: string, subject: string): string {
  if (secret.length < 32) throw new Error('IDENTITY_KEY_SECRET must be at least 32 characters')
  return createHmac('sha256', secret).update(`${provider}\u0000${subject}`).digest('base64url')
}
