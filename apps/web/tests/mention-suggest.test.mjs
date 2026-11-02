import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertMention, mentionBeforeCaret, trimTo } from '../lib/mention-suggest.ts'

test('a mention is being typed only after an @ standing alone with at least one character', () => {
  assert.deepEqual(mentionBeforeCaret('hi @Ad', 6), { start: 3, query: 'ad' })
  assert.deepEqual(mentionBeforeCaret('@a', 2), { start: 0, query: 'a' })
  assert.equal(mentionBeforeCaret('hi @', 4), null)
  assert.equal(mentionBeforeCaret('ada@example', 11), null)
  assert.equal(mentionBeforeCaret('medium.com/@ada', 15), null)
  assert.equal(mentionBeforeCaret('@ada and', 8), null)
  assert.deepEqual(mentionBeforeCaret('@ada and', 3), { start: 0, query: 'ad' })
})

test('an @ inside a web address is part of the address', () => {
  assert.equal(mentionBeforeCaret('see https://example.com/profile?u=@ad', 37), null)
  assert.equal(mentionBeforeCaret('www.example.com/?u=@ad', 22), null)
  // The address ends at a space.
  assert.deepEqual(mentionBeforeCaret('https://example.com @ad', 23), { start: 20, query: 'ad' })
})

test('picking a member replaces the whole word and leaves the caret after a space', () => {
  assert.deepEqual(insertMention('hi @ad', { start: 3, query: 'ad' }, 6, 'adaeze'), { text: 'hi @adaeze ', caret: 11 })
  assert.deepEqual(insertMention('@adxx there', { start: 0, query: 'ad' }, 3, 'ada'), { text: '@ada there', caret: 5 })
})

test('punctuation or a line break after the mention gets no space before it', () => {
  assert.deepEqual(insertMention('hi @ad, there', { start: 3, query: 'ad' }, 6, 'ada'), { text: 'hi @ada, there', caret: 7 })
  assert.deepEqual(insertMention('@ad\nnext', { start: 0, query: 'ad' }, 3, 'ada'), { text: '@ada\nnext', caret: 4 })
  // A letter that cannot be part of a handle still needs one.
  assert.deepEqual(insertMention('@adé', { start: 0, query: 'ad' }, 3, 'ada'), { text: '@ada é', caret: 5 })
})

const member = (handle, displayName = null, following = false) => ({ handle, displayName, avatar: null, founder: false, following })

test('an earlier answer is cut down to what still fits, the exact handle first', () => {
  const known = [member('tunde', 'Tunde Adewale', true), member('adaeze', null, true), member('ad_b'), member('ada'), member('zee', 'Adaeze')]
  assert.deepEqual(trimTo(known, 'ada').map((m) => m.handle), ['ada', 'adaeze', 'zee'])
  assert.deepEqual(trimTo(known, 'adew').map((m) => m.handle), ['tunde'])
  assert.deepEqual(trimTo(known, 'ad').map((m) => m.handle), ['tunde', 'adaeze', 'ad_b', 'ada', 'zee'])
})
