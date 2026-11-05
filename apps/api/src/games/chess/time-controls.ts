/**
 * The time controls a HeyNaija chess challenge may use (docs/games/GAMES.md). The
 * Board API, which phase 3 plays through, takes Rapid, Classical and
 * Correspondence, and Blitz only for direct challenges, which these are; never
 * Bullet. The API refuses anything not in this list, and the web app offers
 * exactly this list (GET /v1/games/chess).
 */
export type Speed = 'blitz' | 'rapid' | 'classical' | 'correspondence'

export type TimeControl =
  | { id: string; speed: Exclude<Speed, 'correspondence'>; limit: number; increment: number }
  | { id: string; speed: 'correspondence'; days: number }

const clock = (minutes: number, increment: number, speed: Exclude<Speed, 'correspondence'>): TimeControl => ({
  id: `${minutes}+${increment}`,
  speed,
  limit: minutes * 60,
  increment,
})
const daily = (days: number): TimeControl => ({ id: `${days}d`, speed: 'correspondence', days })

export const TIME_CONTROLS: readonly TimeControl[] = [
  clock(3, 2, 'blitz'),
  clock(5, 0, 'blitz'),
  clock(5, 3, 'blitz'),
  clock(10, 0, 'rapid'),
  clock(10, 5, 'rapid'),
  clock(15, 10, 'rapid'),
  clock(30, 0, 'classical'),
  clock(30, 20, 'classical'),
  daily(1),
  daily(3),
  daily(5),
  daily(7),
]

export const timeControlById = (id: string): TimeControl | undefined => TIME_CONTROLS.find((tc) => tc.id === id)

export const SPEED_NAMES: Record<Speed, string> = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence' }

/** How a challenge's time reads, from its columns: "Rapid 10+5", "Correspondence, 3 days a move". */
export function describeTime(t: { clockLimit: number | null; clockIncrement: number | null; days: number | null }): {
  speed: Speed
  label: string
} {
  if (t.days != null) return { speed: 'correspondence', label: `${t.days} ${t.days === 1 ? 'day' : 'days'} a move` }
  const limit = t.clockLimit ?? 0
  const increment = t.clockIncrement ?? 0
  const known = TIME_CONTROLS.find((tc) => tc.speed !== 'correspondence' && tc.limit === limit && tc.increment === increment)
  const minutes = limit % 60 === 0 ? String(limit / 60) : (limit / 60).toFixed(1)
  return { speed: known?.speed ?? 'rapid', label: `${minutes}+${increment}` }
}

/** "a rated Rapid game (10+5)", "a casual Correspondence game (3 days a move)". */
export function challengePhrase(t: Parameters<typeof describeTime>[0] & { rated: boolean }): string {
  const { speed, label } = describeTime(t)
  return `a ${t.rated ? 'rated' : 'casual'} ${SPEED_NAMES[speed]} game (${label})`
}

/**
 * The clocks a community tournament may use (phase 6). Tournament games are
 * played on lichess.org, not through the Board API, so Blitz is fine here; still
 * no Bullet, and no correspondence (Lichess tournaments have none).
 */
export const TOURNAMENT_CONTROLS: readonly (TimeControl & { speed: Exclude<Speed, 'correspondence'> })[] = [
  clock(3, 2, 'blitz'),
  clock(5, 0, 'blitz'),
  clock(5, 3, 'blitz'),
  clock(10, 0, 'rapid'),
  clock(10, 5, 'rapid'),
  clock(15, 10, 'rapid'),
  clock(30, 0, 'classical'),
] as (TimeControl & { speed: Exclude<Speed, 'correspondence'> })[]

export const tournamentControlById = (id: string) => TOURNAMENT_CONTROLS.find((tc) => tc.id === id)

/** Arena lengths Lichess offers, in minutes, up to three hours. */
const ARENA_MINUTES = [20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 150, 180]

/**
 * The Arena lengths Lichess accepts for a clock: it wants room for between 3 and
 * 150 games, 3 <= (minutes * 60) / (96 * clock minutes + 48 * increment + 15) <= 150.
 */
export function arenaLengths(tc: { limit: number; increment: number }): number[] {
  const game = 96 * (tc.limit / 60) + 48 * tc.increment + 15
  return ARENA_MINUTES.filter((m) => {
    const games = (m * 60) / game
    return games >= 3 && games <= 150
  })
}

/** Swiss rounds HeyNaija offers. */
export const SWISS_ROUNDS = { min: 3, max: 15 } as const

/** A rough length for a Swiss: each round about two full clocks plus 40 moves of increment, and a minute between rounds. */
export function swissMinutes(tc: { limit: number; increment: number }, rounds: number): number {
  return Math.ceil(rounds * ((2 * (tc.limit + 40 * tc.increment)) / 60 + 1))
}
