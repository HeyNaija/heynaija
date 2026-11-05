import assert from 'node:assert/strict'
import { test } from 'node:test'
import { xpLines } from '../lib/game-scoring.ts'

// The explainer states the API's numbers, whatever they are.
const rules = {
  chess: { finished: 10, win: 10, draw: 5 },
  keno: { round: 2, pointsPerXp: 10, pointsXpMax: 20 },
  competition: { entered: 5, places: [100, 60, 40], topTen: 20 },
}

test('the explainer lines come from the rules', () => {
  const [chess, keno, comps] = xpLines(rules)
  assert.deepEqual(chess.lines[0], ['A game played to the end, won, lost or drawn', '10 XP'])
  assert.deepEqual(chess.lines[1], ['A win, on top', '+10 XP'])
  assert.deepEqual(keno.lines[1], ['Every 10 points you score in a round, on top', '+1 XP, up to +20 a round'])
  assert.deepEqual(comps.lines.map(([, v]) => v), ['5 XP', '+100 XP', '+60 XP', '+40 XP', '+20 XP'])
  assert.equal(comps.lines[4][0], 'Finishing 4th to 10th, on top')
  const changed = xpLines({ ...rules, chess: { finished: 12, win: 8, draw: 4 } })
  assert.deepEqual(changed[0].lines[0][1], '12 XP')
})
