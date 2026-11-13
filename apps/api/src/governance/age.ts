import type { AGE_ASSURANCE_METHODS, AGE_BANDS } from '@heynaija/db'

// How old an account holder is, as far as HeyNaija knows, kept apart from
// having an account, from identity verification and from voting membership
// (ADR 0006). Everything here is pure: GovernanceService reads the
// restricted.age_assurances rows and asks these functions.
//
// Everyone gives a date of birth (ADR 0020, section 1): new members on /join,
// everyone already here once, before they can use the app again. The age is
// worked out from the date on every check, so nobody's age goes out of date.
//
// Three rules hold whatever else changes:
// - An unknown age is never treated as adult. A member with no date of birth on
//   record (they have not answered yet) is "unknown".
// - Content restricted to adults needs at least a stated adult age.
// - Governance voting needs a verified adult age.

export type AgeBand = (typeof AGE_BANDS)[number]
export type AgeMethod = (typeof AGE_ASSURANCE_METHODS)[number]

/** How much the age is backed by: nothing, the person's word, a moderator, or a check. */
export type AgeAssurance = 'none' | 'declared' | 'reviewed' | 'verified'

export type AgeStatus = {
  band: AgeBand | 'unknown'
  assurance: AgeAssurance
}

/** The parts of an age_assurances row the rules look at. */
export type AgeRecord = {
  band: AgeBand
  method: AgeMethod
  birthDate: string | null
  assuredAt: Date
  withdrawnAt: Date | null
}

export const UNKNOWN_AGE: AgeStatus = { band: 'unknown', assurance: 'none' }

const ASSURANCE_OF: Record<AgeMethod, AgeAssurance> = {
  self_declared: 'declared',
  moderator_review: 'reviewed',
  identity_provider: 'verified',
  age_assurance_provider: 'verified',
}

const RANK: Record<AgeAssurance, number> = { none: 0, declared: 1, reviewed: 2, verified: 3 }

/**
 * Whether a record counts: any that has not been withdrawn. The "I am 18 or
 * older" box counts as the member's own statement of 18 or older, as a date of
 * birth does; signup asks for the box while dates of birth are off
 * (BIRTH_DATE_ENABLED, 8 November 2026).
 */
function counts(record: AgeRecord): boolean {
  return !record.withdrawnAt
}

/**
 * Whether the member would be asked for a date of birth: none of their live
 * records has one. Asked only while BIRTH_DATE_ENABLED is on (GovernanceService).
 */
export function birthDateNeeded(records: Pick<AgeRecord, 'birthDate' | 'withdrawnAt'>[]): boolean {
  return !records.some((record) => !record.withdrawnAt && record.birthDate !== null)
}

/** The band a date of birth gives today. */
export function bandOn(birthDate: string, now: Date): AgeBand {
  return ageOn(birthDate, now) >= ADULT_AGE ? '18_plus' : 'under_18'
}

/**
 * The age an account is treated as having. The strongest live record wins: a
 * check beats a moderator's decision, which beats the person's own word; between
 * equally strong records, the newest wins. So a moderator who corrects a date
 * overrides the member's own, and a verified check can settle an appeal. The
 * band comes from the record's date of birth, worked out today, so a minor is
 * an adult on their 18th birthday; only a record without a date (an ID check's
 * yes or no, ADR 0018, not built) uses its stored band.
 */
export function ageStatus(records: AgeRecord[], now: Date): AgeStatus {
  let best: AgeRecord | null = null
  for (const record of records) {
    if (!counts(record)) continue
    if (
      !best ||
      RANK[ASSURANCE_OF[record.method]] > RANK[ASSURANCE_OF[best.method]] ||
      (RANK[ASSURANCE_OF[record.method]] === RANK[ASSURANCE_OF[best.method]] && record.assuredAt > best.assuredAt)
    ) {
      best = record
    }
  }
  if (!best) return UNKNOWN_AGE
  return { band: best.birthDate ? bandOn(best.birthDate, now) : best.band, assurance: ASSURANCE_OF[best.method] }
}

/**
 * What each age-gated thing needs. Requires counsel review before any under-18
 * account exists: whether a stated age is enough for adult-only content, or a
 * check is needed (docs/governance/under-18-rollout.md).
 */
export const ADULT_ASSURANCE_REQUIRED = {
  /** Posts marked sensitive, the 18+ label (adult-content.ts holds the SQL copy of this rule). */
  age_restricted_content: 'declared',
  /**
   * Hosting a Gist, being its co-host or speaker, asking to speak, and the
   * microphone itself (gists/eligibility.ts). Everyone else listens only (ADR
   * 0020, section 4). A stated age until an age check exists (owner, 6 November
   * 2026); not direct messages or calls, which will need the check (ADR 0018).
   */
  gist_stage: 'declared',
  /** Posting a video, at upload and when it goes on a post (ADR 0019, section 4.6, which needs no age check). */
  video_posting: 'declared',
  /** Draft constitution Article 2: voting members are verified adults. */
  governance_vote: 'verified',
} as const satisfies Record<string, AgeAssurance>

export type AdultPurpose = keyof typeof ADULT_ASSURANCE_REQUIRED

/** Whether an account counts as an adult for `purpose`. Unknown and under-18 never do. */
export function isAdultFor(status: AgeStatus, purpose: AdultPurpose): boolean {
  return status.band === '18_plus' && RANK[status.assurance] >= RANK[ADULT_ASSURANCE_REQUIRED[purpose]]
}

/** How strong a record of `method` is, as `ageStatus` ranks them. For the SQL copy of these rules (adult-content.ts). */
export const methodRank = (method: AgeMethod): number => RANK[ASSURANCE_OF[method]]

/** The weakest rank `purpose` accepts. */
export const rankRequired = (purpose: AdultPurpose): number => RANK[ADULT_ASSURANCE_REQUIRED[purpose]]

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

/** `birthDate` is the date to keep with the age record; null for the "18 or older" box. */
export type SignupAgeDecision =
  | { allowed: true; birthDate: string | null }
  | { allowed: false; reason: 'age_not_confirmed' | 'below_minimum_age' | 'under_18_not_open' }

/**
 * Whether a signup may go ahead on age grounds, from the date of birth typed on
 * /join (ADR 0020, section 1). Nobody under MINIMUM_AGE, ever. People aged 13
 * to 17 only when `under18Open`, which is UNDER_18_ACCOUNTS_ENABLED (env.ts);
 * until then the beta is 18+. A date that cannot be a birthday is no answer at all.
 */
export function signupAgeDecision(birthDate: string | null, now: Date, under18Open: boolean): SignupAgeDecision {
  const date = birthDate === null ? null : birthDateFrom(birthDate, now)
  if (!date) return { allowed: false, reason: 'age_not_confirmed' }
  const age = ageOn(date, now)
  if (age < MINIMUM_AGE) return { allowed: false, reason: 'below_minimum_age' }
  if (age < ADULT_AGE && !under18Open) return { allowed: false, reason: 'under_18_not_open' }
  return { allowed: true, birthDate: date }
}
