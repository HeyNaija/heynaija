// Keno's points tables (docs/games/GAMES.md). Points only: they can never be
// bought, sent or swapped for anything. Each ticket keeps the version it was played
// under, so a new table changes only tickets played after it; add a version, never
// edit one that tickets have used.

/** Points a ticket of N numbers earns, by how many of them were drawn. Matches not listed earn nothing. */
export type PayoutTable = Readonly<Record<number, Readonly<Record<number, number>>>>

export const PAYOUT_TABLES: Readonly<Record<string, PayoutTable>> = {
  v1: {
    1: { 1: 3 },
    2: { 2: 12 },
    3: { 2: 1, 3: 40 },
    4: { 2: 1, 3: 5, 4: 100 },
    5: { 3: 2, 4: 20, 5: 400 },
    6: { 3: 1, 4: 5, 5: 60, 6: 1_500 },
    7: { 4: 2, 5: 15, 6: 100, 7: 5_000 },
    8: { 5: 10, 6: 50, 7: 500, 8: 15_000 },
    9: { 5: 5, 6: 25, 7: 150, 8: 2_000, 9: 25_000 },
    10: { 0: 5, 5: 2, 6: 15, 7: 100, 8: 1_000, 9: 5_000, 10: 50_000 },
  },
}

/** The table new tickets are played under. */
export const CURRENT_TABLE = 'v1'

/** Points for a ticket of `spots` numbers with `hits` drawn, under `version`. */
export function pointsFor(version: string, spots: number, hits: number): number {
  const table = PAYOUT_TABLES[version]
  if (!table) throw new Error(`no Keno payout table ${version}`)
  return table[spots]?.[hits] ?? 0
}
