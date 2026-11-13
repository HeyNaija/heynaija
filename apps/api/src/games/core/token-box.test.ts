import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TokenBox } from './token-box.js'

const key = 'a'.repeat(64)
const box = new TokenBox(key)

test('a sealed token opens for the same member and key', () => {
  const sealed = box.seal('lip_secret', 'member-1')
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/)
  assert.ok(!sealed.includes('lip_secret'))
  assert.equal(box.open(sealed, 'member-1'), 'lip_secret')
  assert.notEqual(box.seal('lip_secret', 'member-1'), sealed, 'a fresh IV every time')
})

test('a box does not open for another member, with another key, or once altered', () => {
  const sealed = box.seal('lip_secret', 'member-1')
  assert.throws(() => box.open(sealed, 'member-2'))
  assert.throws(() => new TokenBox('b'.repeat(64)).open(sealed, 'member-1'))
  const [v, iv, body, tag] = sealed.split('.')
  const flipped = `${body![0] === 'A' ? 'B' : 'A'}${body!.slice(1)}`
  assert.throws(() => box.open([v, iv, flipped, tag].join('.'), 'member-1'))
  assert.throws(() => box.open('v2.x.y.z', 'member-1'))
})

test('a key must be 32 bytes of hex', () => {
  assert.throws(() => new TokenBox('short'))
})
