import type { GameScoring } from './api'

// Wording for "How games scoring works" (docs/adr/0028, phase 5), built from the
// rules the API scores by, so the page never states a number the scoring does not use.

const xp = (n: number) => `${n} XP`
const ORDINAL = ['1st', '2nd', '3rd']

/** Each rule as a line: what you do, and what it gives. */
export function xpLines(rules: GameScoring['xp']): { game: string; lines: [string, string][] }[] {
  const { chess, keno, competition } = rules
  return [
    {
      game: 'Chess',
      lines: [
        ['A game played to the end, won, lost or drawn', xp(chess.finished)],
        ['A win, on top', `+${xp(chess.win)}`],
        ['A draw, on top', `+${xp(chess.draw)}`],
        ['A game aborted before it got going', xp(0)],
      ],
    },
    {
      game: 'Keno',
      lines: [
        ['Each round you have a ticket in', xp(keno.round)],
        [`Every ${keno.pointsPerXp} points you score in a round, on top`, `+1 XP, up to +${keno.pointsXpMax} a round`],
      ],
    },
    {
      game: 'Competitions',
      lines: [
        ['Playing in a competition, whatever your place', xp(competition.entered)],
        ...competition.places.map((n, i): [string, string] => [`Finishing ${ORDINAL[i]}, on top`, `+${xp(n)}`]),
        [`Finishing ${competition.places.length + 1}th to 10th, on top`, `+${xp(competition.topTen)}`],
      ],
    },
  ]
}
