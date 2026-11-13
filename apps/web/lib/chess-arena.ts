/** Chess Arena (docs/adr/0028): only The Arbiter starts posts there, so composers never offer it. */
export const CHESS_ARENA = 'chess-arena'
/** Game Night (docs/adr/0028, phase 5): competition results, also started only by The Arbiter. */
export const GAME_NIGHT = 'game-night'

/** Communities where only The Arbiter starts posts, with what their page says instead of a composer. */
export const ARBITER_ONLY: Readonly<Record<string, string>> = {
  [CHESS_ARENA]: 'Threads here are started by The Arbiter, one for each game played on HeyNaija. Reply in one to join the talk.',
  [GAME_NIGHT]: 'Posts here are started by The Arbiter, one for each competition when it ends. Reply in one to join the talk.',
}
