import assert from 'node:assert/strict'
import { test } from 'node:test'
import { textParts } from '../lib/mentions.ts'

test('mentions split the text and lead to the handle the member has now', () => {
  assert.deepEqual(textParts('hi @ada_old and @bayo!', [
    { start: 3, length: 8, handle: 'ada' },
    { start: 16, length: 5, handle: 'bayo' },
  ]), [
    { text: 'hi ' },
    { text: '@ada_old', handle: 'ada' },
    { text: ' and ' },
    { text: '@bayo', handle: 'bayo' },
    { text: '!' },
  ])
})

test('text without mentions, or with none the reader can see, is one plain run', () => {
  assert.deepEqual(textParts('hello @nobody', []), [{ text: 'hello @nobody' }])
  assert.deepEqual(textParts('hello', undefined), [{ text: 'hello' }])
})

test('offsets count UTF-16 code units, as the API stores them', () => {
  const text = '🇳🇬 @ada'
  assert.deepEqual(textParts(text, [{ start: text.indexOf('@'), length: 4, handle: 'ada' }]), [
    { text: '🇳🇬 ' },
    { text: '@ada', handle: 'ada' },
  ])
})

test('a mention that does not fit the text stays plain', () => {
  const text = 'hey @ada'
  for (const bad of [
    { start: 0, length: 4, handle: 'x' }, // not on an @
    { start: 4, length: 9, handle: 'x' }, // past the end
  ]) {
    assert.deepEqual(textParts(text, [bad]), [{ text }])
  }
  // Overlapping the one before: only the first counts.
  assert.deepEqual(textParts(text, [{ start: 4, length: 4, handle: 'ada' }, { start: 5, length: 3, handle: 'x' }]), [
    { text: 'hey ' },
    { text: '@ada', handle: 'ada' },
  ])
})
