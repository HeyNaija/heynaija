import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HOLD_MS, LEAST_MS, NO_TIMES_MS, retryPause, waitLimit } from '../lib/trivia-wait.ts'

const at = Date.parse('2026-11-22T19:13:00.000Z')
const round = (extra = {}) => ({ status: 'live', startsAt: '2026-11-22T19:00:00.000Z', current: null, ...extra })
const question = (opensAt, closesAt, prompt) => ({ opensAt, closesAt, prompt })

test('a late reply is given up on two seconds after the question opens or closes', () => {
  // The countdown: the text comes as the question opens, 5 s from now.
  assert.equal(waitLimit(round({ current: question('2026-11-22T19:13:05.000Z', '2026-11-22T19:13:25.000Z', null) }), at, 0), 7_000)
  // The question on screen: the next reply comes as it closes, 15 s from now.
  assert.equal(waitLimit(round({ current: question('2026-11-22T19:12:55.000Z', '2026-11-22T19:13:15.000Z', 'Who is this?') }), at, 0), 17_000)
  // Open by the server's clock but no text here: the API answers at once, so a short wait.
  assert.equal(waitLimit(round({ current: question('2026-11-22T19:12:58.000Z', '2026-11-22T19:13:18.000Z', null) }), at, 0), LEAST_MS)
  // Never past the API's own 25 seconds, with room to spare.
  assert.equal(waitLimit(round({ current: question('2026-11-22T19:14:30.000Z', '2026-11-22T19:14:50.000Z', null) }), at, 0), HOLD_MS)
})

test('without a question the page asks again every ten seconds while the round is on', () => {
  assert.equal(waitLimit(round({ status: 'scheduled' }), at, 0), NO_TIMES_MS)
  assert.equal(waitLimit(round({ status: 'live' }), at, 0), NO_TIMES_MS)
  // The host checking typed answers: the results can wait a little.
  assert.equal(waitLimit(round({ status: 'reviewing' }), at, 0), HOLD_MS)
})

test('each request given up on in a row gets longer, so a slow line still gets through', () => {
  const missing = round({ current: question('2026-11-22T19:12:58.000Z', '2026-11-22T19:13:18.000Z', null) })
  assert.deepEqual([0, 1, 2, 3, 4].map((cuts) => waitLimit(missing, at, cuts)), [4_000, 8_000, 16_000, 30_000, 30_000])
})

test('during a round a failed request is tried again within two seconds', () => {
  const live = round({ current: question('2026-11-22T19:13:05.000Z', '2026-11-22T19:13:25.000Z', null) })
  assert.deepEqual([1, 2, 3, 4].map((n) => retryPause(live, at, n)), [1_000, 2_000, 2_000, 2_000])
  // Starting within 10 minutes counts as on.
  assert.equal(retryPause(round({ status: 'scheduled', startsAt: '2026-11-22T19:20:00.000Z' }), at, 5), 2_000)
  // A round days away backs off as before, up to 30 seconds.
  const later = round({ status: 'scheduled', startsAt: '2026-11-25T19:00:00.000Z' })
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => retryPause(later, at, n)), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
})
