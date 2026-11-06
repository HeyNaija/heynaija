/**
 * Chess Arena and The Arbiter (docs/adr/0018, phase 3), as plain values so posts
 * and members can use them without depending on the chess module.
 */

/** The Arbiter: HeyNaija Games' automated account. Nobody signs in to it. */
export const ARBITER_ID = 'a7b17e70-0000-4000-8000-000000000001'
export const ARBITER_HANDLE = 'arbiter'
/** Used only if a person already had `arbiter` before The Arbiter existed. */
export const ARBITER_FALLBACK_HANDLE = 'arbiter_hn'

/** One thread for every match; only The Arbiter starts threads there. */
export const ARENA_SLUG = 'chess-arena'

/** Competition results (docs/adr/0018, phase 5); only The Arbiter starts posts there too. */
export const GAME_NIGHT_SLUG = 'game-night'

/** Communities where only The Arbiter starts posts, and what anyone else trying is told. */
export const ARBITER_ONLY: Readonly<Record<string, string>> = {
  [ARENA_SLUG]: 'Chess Arena threads are started for each game; reply in one instead.',
  [GAME_NIGHT_SLUG]: 'Game Night posts are competition results from The Arbiter; reply to one instead.',
}

/** Handles nobody may take by signing up or renaming. */
export const RESERVED_HANDLES: readonly string[] = [ARBITER_HANDLE, ARBITER_FALLBACK_HANDLE]
