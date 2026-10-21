import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keyBytes, madeWithKey, pushSupport } from '../lib/push.ts'

const android = 'Mozilla/5.0 (Linux; Android 14; TECNO KJ5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'
const operaMini = 'Opera/9.80 (Android; Opera Mini/77.0.2254/191.256; U; en) Presto/2.12.423 Version/12.16'

test('an Android browser with push can turn it on, in a tab', () => {
  assert.equal(pushSupport({ userAgent: android, maxTouchPoints: 5, standalone: false, hasPush: true }), 'supported')
})

test('an iPhone or iPad needs HeyNaija on its Home Screen first', () => {
  assert.equal(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: false, hasPush: false }), 'install')
  assert.equal(pushSupport({ userAgent: ipad, maxTouchPoints: 5, standalone: false, hasPush: false }), 'install')
  assert.equal(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: true, hasPush: true }), 'supported')
  // Opened from the Home Screen on an iOS too old for push.
  assert.equal(pushSupport({ userAgent: iphone, maxTouchPoints: 5, standalone: true, hasPush: false }), 'unsupported')
})

test('a Mac is not taken for an iPad', () => {
  assert.equal(pushSupport({ userAgent: ipad, maxTouchPoints: 0, standalone: false, hasPush: true }), 'supported')
})

test('a browser without push is told so', () => {
  assert.equal(pushSupport({ userAgent: operaMini, maxTouchPoints: 5, standalone: false, hasPush: false }), 'unsupported')
})

test('a base64url key becomes its bytes, and a subscription is matched to the key it was made with', () => {
  const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256)
  const key = Buffer.from(bytes).toString('base64url')
  assert.ok(key.includes('-') || key.includes('_'), 'the test key should use the URL-safe characters')
  assert.deepEqual(keyBytes(key), bytes)
  assert.equal(madeWithKey(bytes.buffer, key), true)
  const other = bytes.slice()
  other[10] ^= 1
  assert.equal(madeWithKey(other.buffer, key), false)
  assert.equal(madeWithKey(null, key), false)
})
