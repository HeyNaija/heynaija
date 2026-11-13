import { type SQL, sql } from 'drizzle-orm'

/**
 * True when `memberId` has the Founder badge: one of the people who founded
 * HeyNaija, given it by hand with `pnpm founder:grant` and kept for good. Unlike
 * the green tick it is not about identity, so verification being off does not
 * hide it.
 */
export const isFounder = (memberId: SQL) =>
  sql<boolean>`exists(select 1 from profile_badges fb where fb.member_id = ${memberId} and fb.kind = 'founder')`

/** True for HeyNaija's own automated accounts, which nobody signs in to (The Arbiter, docs/adr/0028). */
export const isAutomated = (memberId: SQL) =>
  sql<boolean>`exists(select 1 from profile_badges ab where ab.member_id = ${memberId} and ab.kind = 'automated')`
