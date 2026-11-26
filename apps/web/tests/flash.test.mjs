import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockFlash, clearsFlash, decodeFlash, deleteFlash, encodeFlash, FLASH_MESSAGES, pinFlash } from '../lib/flash.ts'

const ID = '0b0e3c1e-6f0a-4f6e-9a57-0d7f0e2f9c11'

test('a flash survives the cookie and comes back as its fixed words', () => {
  assert.deepEqual(decodeFlash(encodeFlash('post_deleted', ID)), { id: ID, kind: 'success', message: 'Post deleted' })
  assert.deepEqual(decodeFlash(encodeFlash('action_failed', ID)), {
    id: ID,
    kind: 'error',
    message: 'That did not work. Try again in a moment.',
  })
})

test('the cookie names a message and an id, and holds nothing else', () => {
  assert.equal(encodeFlash('post_deleted', ID), `post_deleted.${ID}`)
})

test('every message in the list can be sent', () => {
  for (const key of Object.keys(FLASH_MESSAGES)) {
    assert.equal(decodeFlash(encodeFlash(key, ID))?.message, FLASH_MESSAGES[key].message)
  }
})

test('a cookie that is not one of ours shows nothing', () => {
  for (const value of [
    undefined,
    '',
    'post_deleted',
    'post_deleted.',
    `.${ID}`,
    `nonsense.${ID}`,
    // Names every object has must not pass for a message.
    `constructor.${ID}`,
    `__proto__.${ID}`,
    `toString.${ID}`,
    'post_deleted.not-an-id',
    `post_deleted.${ID}.extra`,
    `post_deleted.${ID}<script>alert(1)</script>`,
    `<b>Send your code to @someone</b>.${ID}`,
    `post_deleted.${'a'.repeat(5000)}`,
  ]) {
    assert.equal(decodeFlash(value), null, String(value))
  }
})

test('deleting a post says so, also when it was already gone, and says when it failed', () => {
  assert.equal(deleteFlash(204), 'post_deleted')
  assert.equal(deleteFlash(200), 'post_deleted')
  // A second press or another tab got there first.
  assert.equal(deleteFlash(404), 'post_deleted')
  for (const status of [403, 409, 429, 500, 502]) assert.equal(deleteFlash(status), 'action_failed', String(status))
})

test('a pin says which pin it was and which way, and a failure says it failed', () => {
  assert.equal(pinFlash('profile', true, 204), 'pinned_to_profile')
  assert.equal(pinFlash('profile', false, 204), 'unpinned_from_profile')
  assert.equal(pinFlash('community', true, 200), 'pinned_in_community')
  assert.equal(pinFlash('community', false, 200), 'unpinned_in_community')
  for (const where of ['profile', 'community']) {
    for (const on of [true, false]) {
      for (const status of [403, 404, 409, 429, 500]) assert.equal(pinFlash(where, on, status), 'action_failed', `${where} ${on} ${status}`)
    }
  }
})

test('blocking says so or says it failed; unblocking and muting say nothing', () => {
  assert.equal(blockFlash('block', true, 204), 'blocked')
  for (const status of [404, 429, 500]) assert.equal(blockFlash('block', true, status), 'action_failed', String(status))
  assert.equal(blockFlash('block', false, 204), null)
  assert.equal(blockFlash('block', false, 500), null)
  assert.equal(blockFlash('mute', true, 204), null)
  assert.equal(blockFlash('mute', true, 500), null)
})

test('a shown flash clears the cookie only while the cookie still holds that flash', () => {
  const OTHER = '6c1b9a52-1f0e-4c4b-8a4e-3b7e8f2d1a90'
  assert.equal(clearsFlash(encodeFlash('post_deleted', ID), ID), true)
  // A newer flash was set after this one was shown.
  assert.equal(clearsFlash(encodeFlash('blocked', OTHER), ID), false)
  assert.equal(clearsFlash(undefined, ID), false)
  assert.equal(clearsFlash(`nonsense.${ID}`, ID), false)
  assert.equal(clearsFlash(encodeFlash('post_deleted', ID), ''), false)
})
