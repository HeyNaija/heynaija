import { type Db, blocks, members } from '@heynaija/db'
import { and, eq, or } from 'drizzle-orm'

/**
 * Who may make or receive a 1:1 call (docs/adr/0017 section 5). Every call
 * decision goes through `canCall`; do not add a second check elsewhere.
 *
 * DARK-LAUNCH SEAMS. Two of the ADR's conditions do not exist yet, and each is
 * one named function below so the real thing replaces a body, not the callers:
 *  - `isAgeVerifiedAdult`: age verification (ADR 0006). Today true only for a
 *    handle on the CALLS_MEMBERS allow-list. The `members` table has no
 *    minor/age field, so this seam is also what keeps minors out: a member who
 *    is not on the list is always refused. CALLS_ENABLED must stay off for the
 *    public until a real age check replaces it.
 *  - `hasDmConversation`: direct messages (ADR 0016). Replaced by the real
 *    "these two have an accepted conversation in the recipient's inbox" check
 *    when DMs ship. Until then: both on the allow-list, no block either way.
 * "DMs opted in" has no data yet; the "Allow calls" switch stands in for it.
 */

type Q = Pick<Db, 'select'>
export type CallEligibilityConfig = { callsMembers: readonly string[] }

/** SEAM. Only allow-listed handles count as verified adults. See the file comment. */
export function isAgeVerifiedAdult(member: { handle: string }, config: CallEligibilityConfig): boolean {
  return config.callsMembers.includes(member.handle.toLowerCase())
}

/**
 * SEAM. Whether the two have a conversation to call within. Today: both are
 * allow-listed (checked by the caller of this seam through `isAgeVerifiedAdult`)
 * and no block stands between them, either way.
 */
async function hasDmConversation(q: Q, a: string, b: string): Promise<boolean> {
  const [blocked] = await q
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))))
    .limit(1)
  return !blocked
}

async function memberMayCall(q: Q, config: CallEligibilityConfig, memberId: string): Promise<boolean> {
  const [row] = await q
    .select({ handle: members.handle, active: members.active, status: members.status, allowCalls: members.allowCalls })
    .from(members)
    .where(eq(members.id, memberId))
  if (!row) return false
  const notSuspended = row.active && row.status !== 'suspended'
  return notSuspended && row.allowCalls && isAgeVerifiedAdult(row, config)
}

/**
 * The one eligibility decision, read from live data. With only `memberId`: may
 * this member use calls at all (active, not suspended, "Allow calls" on, a
 * verified adult). With `counterpartId`: may these two call each other, which
 * also needs the counterpart to pass the same test and a conversation between them.
 */
export async function canCall(q: Q, config: CallEligibilityConfig, memberId: string, counterpartId?: string): Promise<boolean> {
  if (!(await memberMayCall(q, config, memberId))) return false
  if (counterpartId === undefined) return true
  if (counterpartId === memberId) return false
  if (!(await memberMayCall(q, config, counterpartId))) return false
  return hasDmConversation(q, memberId, counterpartId)
}
