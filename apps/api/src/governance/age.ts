import type { AGE_ASSURANCE_METHODS, AGE_BANDS } from '@heynaija/db'

// How old an account holder is, as far as HeyNaija knows, kept apart from
// having an account, from identity verification and from voting membership
// (ADR 0006). Everything here is pure: GovernanceService reads the
// restricted.age_assurances rows and asks these functions.
//
// Three rules hold whatever else changes:
// - An unknown age is never treated as adult. Accounts from before the 18+ beta
//   rule have no age on record and stay "unknown" until they say otherwise.
// - Content restricted to adults needs at least a stated adult age.
// - Governance voting needs a verified adult age.

export type AgeBand = (typeof AGE_BANDS)[number]
export type AgeMethod = (typeof AGE_ASSURANCE_METHODS)[number]

/** How much the age is backed by: nothing, the person's word, a moderator, or a check. */
export type AgeAssurance = 'none' | 'declared' | 'reviewed' | 'verified'

export type AgeStatus = {
  band: AgeBand | 'unknown'
  assurance: AgeAssurance
  /** An under-18 band whose review date has passed: ask again before treating them as adult. */
  reviewDue: boolean
}

/** The parts of an age_assurances row the rules look at. */
export type AgeRecord = {
  band: AgeBand
  method: AgeMethod
  assuredAt: Date
  reviewAfter: Date | null
  withdrawnAt: Date | null
}

export const UNKNOWN_AGE: AgeStatus = { band: 'unknown', assurance: 'none', reviewDue: false }

const ASSURANCE_OF: Record<AgeMethod, AgeAssurance> = {
  self_declared: 'declared',
  moderator_review: 'reviewed',
  identity_provider: 'verified',
  age_assurance_provider: 'verified',
}

const RANK: Record<AgeAssurance, number> = { none: 0, declared: 1, reviewed: 2, verified: 3 }

/**
 * The age an account is treated as having. The strongest live statement wins:
 * a check beats a moderator's decision, which beats the person's own word; between
 * equally strong statements, the newest wins. So a moderator who finds a
 * self-declared adult is a child overrides the declaration, and a verified check
 * can settle an appeal. Withdrawn statements count for nothing.
 */
export function ageStatus(records: AgeRecord[], now: Date): AgeStatus {
  let best: AgeRecord | null = null
  for (const record of records) {
    if (record.withdrawnAt) continue
    if (
      !best ||
      RANK[ASSURANCE_OF[record.method]] > RANK[ASSURANCE_OF[best.method]] ||
      (RANK[ASSURANCE_OF[record.method]] === RANK[ASSURANCE_OF[best.method]] && record.assuredAt > best.assuredAt)
    ) {
      best = record
    }
  }
  if (!best) return UNKNOWN_AGE
  return {
    band: best.band,
    assurance: ASSURANCE_OF[best.method],
    reviewDue: best.band === 'under_18' && best.reviewAfter !== null && best.reviewAfter <= now,
  }
}

/**
 * What each age-gated thing needs. Requires counsel review before any under-18
 * account exists: whether a stated age is enough for adult-only content, or a
 * check is needed (docs/governance/under-18-rollout.md).
 */
export const ADULT_ASSURANCE_REQUIRED = {
  /** Posts, communities or media labelled 18+ (no such label exists yet). */
  age_restricted_content: 'declared',
  /** Draft constitution Article 2: voting members are verified adults. */
  governance_vote: 'verified',
} as const satisfies Record<string, AgeAssurance>

export type AdultPurpose = keyof typeof ADULT_ASSURANCE_REQUIRED

/** Whether an account counts as an adult for `purpose`. Unknown and under-18 never do. */
export function isAdultFor(status: AgeStatus, purpose: AdultPurpose): boolean {
  return status.band === '18_plus' && RANK[status.assurance] >= RANK[ADULT_ASSURANCE_REQUIRED[purpose]]
}

/** What someone said about their age at signup: adult, under 18, or nothing. */
export type DeclaredAge = 'adult' | 'under_18' | null

export type SignupAgeDecision =
  | { allowed: true }
  | { allowed: false; reason: 'age_not_confirmed' | 'under_18_not_open' }

/**
 * Whether a signup may go ahead on age grounds. During the beta only people who
 * say they are 18 or older can join. That is a temporary restriction, not the
 * permanent policy: under-18 accounts are refused until the work in
 * docs/governance/under-18-rollout.md is approved and built, and
 * UNDER_18_ACCOUNTS_ENABLED cannot be switched on before then (env.ts). This is
 * where that work would add guardian consent and the minimum age.
 */
export function signupAgeDecision(declared: DeclaredAge): SignupAgeDecision {
  if (declared === 'adult') return { allowed: true }
  if (declared === null) return { allowed: false, reason: 'age_not_confirmed' }
  return { allowed: false, reason: 'under_18_not_open' }
}
