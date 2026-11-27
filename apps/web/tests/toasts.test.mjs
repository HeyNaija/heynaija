import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addToast, dismissToast, EMPTY_TOASTS, expireToasts, nextExpiry, pauseToasts, resumeToasts, TOAST_MAX, TOAST_MS } from '../lib/toasts.ts'

const toast = (id, kind = 'success', message = `Message ${id}`) => ({ id, kind, message })
const ids = (state) => state.toasts.map((t) => t.id)

test('a toast goes by itself when its time is up, an error later than a success', () => {
  let state = addToast(EMPTY_TOASTS, toast('a'), 1000)
  state = addToast(state, toast('b', 'error'), 1000)
  assert.equal(nextExpiry(state), TOAST_MS.success)
  assert.ok(TOAST_MS.error > TOAST_MS.success)

  assert.deepEqual(ids(expireToasts(state, 1000 + TOAST_MS.success - 1)), ['a', 'b'])
  assert.deepEqual(ids(expireToasts(state, 1000 + TOAST_MS.success)), ['b'])
  assert.deepEqual(ids(expireToasts(state, 1000 + TOAST_MS.error)), [])
})

test('with nothing showing there is nothing to wait for', () => {
  assert.equal(nextExpiry(EMPTY_TOASTS), null)
})

test('time already spent counts when a second toast arrives', () => {
  let state = addToast(EMPTY_TOASTS, toast('a'), 0)
  state = addToast(state, toast('b'), 2000)
  assert.equal(nextExpiry(state), TOAST_MS.success - 2000)
  assert.deepEqual(ids(expireToasts(state, TOAST_MS.success)), ['b'])
})

test('paused toasts stay, and carry on from where they stopped', () => {
  let state = addToast(EMPTY_TOASTS, toast('a'), 0)
  state = pauseToasts(state, 3000)
  assert.equal(nextExpiry(state), null)
  assert.deepEqual(ids(expireToasts(state, 60_000)), ['a'])

  state = resumeToasts(state, 60_000)
  assert.equal(nextExpiry(state), TOAST_MS.success - 3000)
  assert.deepEqual(ids(expireToasts(state, 60_000 + TOAST_MS.success - 3001)), ['a'])
  assert.deepEqual(ids(expireToasts(state, 60_000 + TOAST_MS.success - 3000)), [])
})

test('pausing twice or resuming twice changes nothing', () => {
  let state = addToast(EMPTY_TOASTS, toast('a'), 0)
  state = pauseToasts(pauseToasts(state, 1000), 4000)
  state = resumeToasts(resumeToasts(state, 5000), 7000)
  assert.equal(nextExpiry(expireToasts(state, 7000)), TOAST_MS.success - 1000 - 2000)
})

test('a toast that arrives while the others are paused waits with them', () => {
  let state = pauseToasts(addToast(EMPTY_TOASTS, toast('a'), 0), 1000)
  state = addToast(state, toast('b'), 2000)
  assert.equal(nextExpiry(state), null)
  assert.deepEqual(ids(expireToasts(state, 90_000)), ['a', 'b'])
})

test('closing one leaves the rest', () => {
  let state = addToast(EMPTY_TOASTS, toast('a'), 0)
  state = addToast(state, toast('b'), 0)
  assert.deepEqual(ids(dismissToast(state, 'a')), ['b'])
  assert.deepEqual(ids(dismissToast(state, 'missing')), ['a', 'b'])
})

test('closing the last one while paused does not leave the next toast paused for ever', () => {
  let state = pauseToasts(addToast(EMPTY_TOASTS, toast('a'), 0), 1000)
  state = dismissToast(state, 'a')
  state = addToast(state, toast('b'), 5000)
  assert.equal(nextExpiry(state), TOAST_MS.success)
  assert.deepEqual(ids(expireToasts(state, 5000 + TOAST_MS.success)), [])

  // With others still showing, the pause holds: the pointer is still on them.
  state = pauseToasts(addToast(addToast(EMPTY_TOASTS, toast('a'), 0), toast('b'), 0), 1000)
  assert.equal(nextExpiry(dismissToast(state, 'a')), null)
})

test('only a few show: the oldest makes room for the newest', () => {
  let state = EMPTY_TOASTS
  for (let i = 0; i < TOAST_MAX + 2; i++) state = addToast(state, toast(`t${i}`), 0)
  assert.equal(TOAST_MAX, 3)
  assert.deepEqual(ids(state), ['t2', 't3', 't4'])
})

test('the same message again restarts its time instead of stacking', () => {
  let state = addToast(EMPTY_TOASTS, toast('a', 'success', 'Link copied'), 0)
  state = addToast(state, toast('b', 'success', 'Other'), 0)
  state = addToast(state, toast('c', 'success', 'Link copied'), 4000)
  assert.deepEqual(ids(state), ['b', 'c'])
  assert.deepEqual(ids(expireToasts(state, TOAST_MS.success)), ['c'])
  // The same words as an error are a different message.
  assert.deepEqual(ids(addToast(state, toast('d', 'error', 'Link copied'), 4000)), ['b', 'c', 'd'])
})

test('the same toast handed over twice shows once and keeps its time', () => {
  const state = addToast(addToast(EMPTY_TOASTS, toast('a'), 0), toast('a'), 3000)
  assert.deepEqual(ids(state), ['a'])
  assert.equal(nextExpiry(state), TOAST_MS.success - 3000)
})
