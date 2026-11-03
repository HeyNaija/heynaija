/**
 * Chess Arena and The Arbiter (docs/adr/0018, phase 3), as plain values so posts
 * and members can use them without depending on the chess module.
 */

/** The Arbiter: HeyNaija's automated chess account. Nobody signs in to it. */
export const ARBITER_ID = 'a7b17e70-0000-4000-8000-000000000001'
export const ARBITER_HANDLE = 'arbiter'
/** Used only if a person already had `arbiter` before The Arbiter existed. */
export const ARBITER_FALLBACK_HANDLE = 'arbiter_hn'

/** One thread for every match; only The Arbiter starts threads there. */
export const ARENA_SLUG = 'chess-arena'

/** Handles nobody may take by signing up or renaming. */
export const RESERVED_HANDLES: readonly string[] = [ARBITER_HANDLE, ARBITER_FALLBACK_HANDLE]
