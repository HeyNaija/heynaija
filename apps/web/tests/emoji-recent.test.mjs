import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RECENT_MAX, readRecent, remember } from '../lib/emoji-recent.ts'

test('the emoji just used goes first, and appears once', () => {
  assert.deepEqual(remember(['😀', '🎉'], '🎉'), ['🎉', '😀'])
  assert.deepEqual(remember([], '😀'), ['😀'])
})

test('only the most recent ones are kept', () => {
  const many = Array.from({ length: RECENT_MAX }, (_, i) => `e${i}`)
  const next = remember(many, '😀')
  assert.equal(next.length, RECENT_MAX)
  assert.equal(next[0], '😀')
  assert.equal(next.includes(many.at(-1)), false)
})

test('whatever storage holds that is not a list of strings reads as none', () => {
  assert.deepEqual(readRecent('["😀","🎉"]'), ['😀', '🎉'])
  for (const bad of [null, '', 'nope', '{"a":1}', '[1,2]', '["😀",2]']) assert.deepEqual(readRecent(bad), [])
})
