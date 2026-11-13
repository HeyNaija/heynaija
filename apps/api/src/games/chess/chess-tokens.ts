/** Dependency tokens and the error type shared by the chess services (docs/adr/0028). */

export const LICHESS = Symbol('LICHESS')
/** The TokenBox for GAMES_TOKEN_KEY, or null when no key is set and linking is not available. */
export const TOKEN_BOX = Symbol('TOKEN_BOX')

/** Starts a game once Lichess has made it (ChessGamesService.start, then the watcher). */
export const GAME_STARTER = Symbol('GAME_STARTER')
export type AcceptedChallenge = {
  id: string
  challengerId: string
  challengedId: string
  rated: boolean
  clockLimit: number | null
  clockIncrement: number | null
  days: number | null
  openThread: boolean
}
export interface GameStarter {
  /** `challengerColor` is the colour the challenger plays. */
  begin(challenge: AcceptedChallenge, gameId: string, challengerColor: 'white' | 'black'): Promise<void>
}

export type ChessErrorCode =
  | 'not_available'
  | 'not_linked'
  | 'opponent_not_linked'
  | 'not_found'
  | 'invalid'
  | 'self'
  | 'duplicate'
  | 'link_expired'
  | 'already_linked'
  | 'reconnect'
  | 'lichess_busy'
  | 'lichess_unavailable'
  | 'lichess_rejected'
  | 'illegal_move'
  | 'game_over'
  // Community teams and tournaments (phase 6).
  | 'not_moderator'
  | 'not_leader'
  | 'needs_scope'
  | 'team_taken'
  | 'no_team'

export class ChessError extends Error {
  constructor(
    readonly code: ChessErrorCode,
    message: string,
  ) {
    super(message)
  }
}
