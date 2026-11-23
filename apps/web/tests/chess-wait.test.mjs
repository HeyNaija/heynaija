import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOLD_MS, PLAYING_MS, retryPause, waitLimit } from '../lib/chess-wait.ts'

const blitz = { finished: false, clock: { limit: 180, increment: 2 } }
const correspondence = { finished: false, clock: null }

test('in a game with a clock a request is given up on after ten seconds', () => {
  assert.equal(waitLimit(blitz), PLAYING_MS)
  assert.equal(PLAYING_MS, 10_000)
})

test('in a correspondence game, or one that is over, a request waits out the API’s 25 seconds with room to spare', () => {
  assert.equal(waitLimit(correspondence), HOLD_MS)
  assert.equal(waitLimit({ ...blitz, finished: true }), HOLD_MS)
  assert.equal(HOLD_MS, 30_000)
})

test('while a game goes on a failed request is tried again within two seconds', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => retryPause(blitz, n)), [1_000, 2_000, 2_000, 2_000])
  assert.deepEqual([1, 2, 3].map((n) => retryPause(correspondence, n)), [1_000, 2_000, 2_000])
})

test('once a game is over a failed request backs off as before, up to 30 seconds', () => {
  const over = { ...blitz, finished: true }
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => retryPause(over, n)), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
})
