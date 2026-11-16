import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withDeadline } from './link-queue.js'

test('a job that never settles is failed at the deadline', async () => {
  await assert.rejects(withDeadline(new Promise<void>(() => {}), 50), /job timed out after 50 ms/)
})

test('a job that settles in time keeps its result and leaves no timer behind', async () => {
  assert.equal(await withDeadline(Promise.resolve('done'), 60_000), 'done')
  await assert.rejects(withDeadline(Promise.reject(new Error('boom')), 60_000), /boom/)
})
