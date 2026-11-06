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

/** Nobody younger can join, ever (ADR 0020, question 1), on the web or in the app stores. */
export const MINIMUM_AGE = 13
/** Adult, for every age rule here. */
export const ADULT_AGE = 18

// Ages are worked out on the day in Lagos, which is UTC+1 all year.
const LAGOS_OFFSET_MS = 60 * 60 * 1000

/** Today's date in Lagos, as YYYY-MM-DD. */
function lagosToday(now: Date): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10)
}

/** Whole years someone born on `birthDate` (YYYY-MM-DD) has lived, on today's date in Lagos. */
export function ageOn(birthDate: string, now: Date): number {
  const [by = 0, bm = 0, bd = 0] = birthDate.split('-').map(Number)
  const [ty = 0, tm = 0, td = 0] = lagosToday(now).split('-').map(Number)
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}

/**
 * `text` if it is a date someone could have been born on: a real day of the
 * calendar as YYYY-MM-DD, not in the future and not more than 120 years ago.
 * Anything else is a typing mistake, never an age.
 */
export function birthDateFrom(text: string, now: Date): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  if (text > lagosToday(now) || ageOn(text, now) > 120) return null
  return text
}

/** The start of someone's 18th birthday in Lagos. Born on 29 February, 1 March. */
function eighteenthBirthday(birthDate: string): Date {
  const [year = 0, month = 0, day = 0] = birthDate.split('-').map(Number)
  return new Date(Date.UTC(year + ADULT_AGE, month - 1, day) - LAGOS_OFFSET_MS)
}

/** What a signup records about the person's age: the band, and the date it came from. */
export type AgeStatement = { band: AgeBand; birthDate: string | null; reviewAfter: Date | null }

/** What the "I am 18 or older" box said, before signup asked for a date of birth. */
export const TICKED_ADULT: AgeStatement = { band: '18_plus', birthDate: null, reviewAfter: null }

export type SignupAgeDecision =
  | ({ allowed: true } & AgeStatement)
  | { allowed: false; reason: 'age_not_confirmed' | 'below_minimum_age' | 'under_18_not_open' }

/**
 * Whether a signup may go ahead on age grounds, from the date of birth typed on
 * /join (ADR 0020, section 1). Nobody under MINIMUM_AGE, ever. People aged 13
 * to 17 only when `under18Open`, which is UNDER_18_ACCOUNTS_ENABLED (env.ts);
 * until then the beta is 18+. A minor's band is checked again on their 18th
 * birthday. A date that cannot be a birthday is no answer at all.
 */
export function signupAgeDecision(birthDate: string | null, now: Date, under18Open: boolean): SignupAgeDecision {
  const date = birthDate === null ? null : birthDateFrom(birthDate, now)
  if (!date) return { allowed: false, reason: 'age_not_confirmed' }
  const age = ageOn(date, now)
  if (age < MINIMUM_AGE) return { allowed: false, reason: 'below_minimum_age' }
  if (age >= ADULT_AGE) return { allowed: true, band: '18_plus', birthDate: date, reviewAfter: null }
  if (!under18Open) return { allowed: false, reason: 'under_18_not_open' }
  return { allowed: true, band: 'under_18', birthDate: date, reviewAfter: eighteenthBirthday(date) }
}
