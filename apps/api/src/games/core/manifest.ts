/** Where a game is: playable, playable with rough edges, or announced only. */
export const GAME_STATUSES = ['live', 'beta', 'coming_soon'] as const
export type GameStatus = (typeof GAME_STATUSES)[number]

/** Chess ranks by rating (Lichess's), keno by points scored in a season. */
export type RankingType = 'rating' | 'points'

/** One line of a game's leaderboard, already ranked. */
export type LeaderboardRow = { memberId: string; rank: number; value: number }

/**
 * What a game supplies to the shared core once it is built (docs/games/GAMES.md,
 * "Shared core"). A coming_soon game has none.
 */
export interface GameProviders {
  /** The member's stats for this game, or null if they have not played it. */
  stats(memberId: string): Promise<Record<string, unknown> | null>
  /** The season's precomputed standings, best first. */
  leaderboard(seasonId: string, limit: number): Promise<LeaderboardRow[]>
}

/**
 * Everything the registry knows about one game. The API is the source of truth
 * for it; the web app reads the public part through GET /v1/games.
 */
export type GameManifest = {
  slug: string
  name: string
  tagline: string
  description: string
  /** A picture under /media or /brand; null until approved art exists, and the web app shows the game's icon. */
  cover: string | null
  status: GameStatus
  rankingType: RankingType
  supportsCompetitions: boolean
  providers?: GameProviders
}

export type PublicGameManifest = Omit<GameManifest, 'providers'>

/** The manifest as sent to the browser: the providers are server code. */
export const publicManifest = ({ providers: _providers, ...rest }: GameManifest): PublicGameManifest => rest
