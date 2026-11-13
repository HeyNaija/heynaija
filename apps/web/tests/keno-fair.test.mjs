import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRound, drawNumbers, seedHash } from '../app/(main)/games/keno/_components/fair.ts'

// The same examples as the API's draw tests (apps/api/src/games/keno/keno.service.test.ts):
// the browser's checker must give exactly the numbers the server drew.
const zeros = '0'.repeat(64)

test('the browser checker gives the same hash and numbers as the server', async () => {
  assert.equal(await seedHash(zeros), '60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55')
  assert.deepEqual(await drawNumbers(zeros, 1), [78, 68, 76, 35, 65, 69, 73, 61, 53, 44, 24, 6, 41, 55, 23, 67, 57, 66, 46, 29])
  assert.deepEqual(await drawNumbers('heynaija', 1234), [37, 36, 25, 46, 45, 35, 7, 2, 34, 61, 78, 15, 54, 12, 76, 70, 77, 20, 53, 42])
})

test('a round checks out only when both its hash and its numbers match the seed', async () => {
  const round = { number: 1, seed: zeros, seedHash: await seedHash(zeros), numbers: await drawNumbers(zeros, 1) }
  assert.deepEqual(await checkRound(round), { hashMatches: true, numbersMatch: true })
  assert.deepEqual(await checkRound({ ...round, numbers: [...round.numbers].reverse() }), { hashMatches: true, numbersMatch: false })
  assert.deepEqual(await checkRound({ ...round, seedHash: 'f'.repeat(64) }), { hashMatches: false, numbersMatch: true })
  assert.deepEqual(await checkRound({ ...round, number: 2 }), { hashMatches: true, numbersMatch: false })
})
