import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retryOnce } from '../lib/retry-once.ts'

test('a load that works the first time is called once', async () => {
  let calls = 0
  const value = await retryOnce(async () => {
    calls++
    return 'picker'
  })
  assert.equal(value, 'picker')
  assert.equal(calls, 1)
})

test('a load that fails once is tried again, and its second answer is used', async () => {
  let calls = 0
  const value = await retryOnce(async () => {
    calls++
    if (calls === 1) throw new TypeError('Failed to fetch dynamically imported module')
    return 'picker'
  })
  assert.equal(value, 'picker')
  assert.equal(calls, 2)
})

test('a load that fails twice rejects with the first failure, after two tries only', async () => {
  let calls = 0
  const first = Object.assign(new Error('Loading chunk 123 failed.'), { name: 'ChunkLoadError' })
  await assert.rejects(
    retryOnce(async () => {
      calls++
      throw calls === 1 ? first : new Error('second')
    }),
    (error) => error === first,
  )
  assert.equal(calls, 2)
})
