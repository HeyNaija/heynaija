/**
 * How long a chess game page waits for the API before asking again (docs/adr/0028).
 * The app does the same (ChessWait.kt in heynaija-mobile).
 *
 * The API holds each request until the game changes, or 25 seconds. On patchy mobile
 * data a reply can be lost on the way while the browser still thinks the request is
 * open, and then a move shows late or not at all. A Trivia player on 3G missed whole
 * questions that way (2026-11-22). A move has no set time to come, so the page gives
 * up on a request after a fixed time and asks again: the API answers at once if the
 * game moved on meanwhile.
 */

/** What the waits go by: a game as the API sends it. */
export type GameTimes = {
  finished: boolean
  /** Null for a correspondence game, which has days a move instead. */
  clock: { limit: number; increment: number } | null
}

/** The API holds a request 25 seconds at most: a reply later than this is not coming. */
export const HOLD_MS = 30_000
/** In a game with a clock, a lost reply costs a player their time: give up on a request after this. */
export const PLAYING_MS = 10_000
/** A player's own move or decision comes back from Lichess within a moment. One this late was lost. */
export const LATE_MS = 3_000
/** After a failed request, wait 1 second, then 2, 4… up to this. */
export const RETRY_MAX_MS = 30_000
/** …but while the game goes on, at most this. */
export const RETRY_LIVE_MS = 2_000

/** How long to wait for the next reply. */
export function waitLimit(game: GameTimes): number {
  return !game.finished && game.clock !== null ? PLAYING_MS : HOLD_MS
}

/** How long to wait after the `failures`th failed request in a row. */
export function retryPause(game: GameTimes, failures: number): number {
  const grown = Math.min(1000 * 2 ** Math.min(Math.max(failures - 1, 0), 5), RETRY_MAX_MS)
  return game.finished ? grown : Math.min(grown, RETRY_LIVE_MS)
}
