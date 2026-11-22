import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeFlash, encodeFlash, FLASH_MESSAGES } from '../lib/flash.ts'

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
