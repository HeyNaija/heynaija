import { ARBITER_ID, ARBITER_ONLY, RESERVED_HANDLES as ARBITER_HANDLES } from '../games/chess/arena-ids.js'
import { KEKE_HANDLES, KEKE_ID, NAIJA_TODAY_REFUSAL, NAIJA_TODAY_SLUG } from '../keke/keke-ids.js'

/**
 * HeyNaija's own automated accounts in one place: The Arbiter (docs/adr/0028)
 * and Keke (docs/adr/0030). Members and posts read these, not each account's
 * own file, so a new one is added here once.
 */

/** Handles nobody may take by signing up or renaming. */
export const RESERVED_HANDLES: readonly string[] = [...ARBITER_HANDLES, ...KEKE_HANDLES]

/** A community where only one automated account starts posts, and what anyone else trying is told. */
export type BotOnlyCommunity = { authorId: string; refusal: string }

/** Communities where only an automated account starts posts; members reply. */
export const BOT_ONLY: Readonly<Record<string, BotOnlyCommunity>> = {
  ...Object.fromEntries(Object.entries(ARBITER_ONLY).map(([slug, refusal]) => [slug, { authorId: ARBITER_ID, refusal }])),
  [NAIJA_TODAY_SLUG]: { authorId: KEKE_ID, refusal: NAIJA_TODAY_REFUSAL },
}
