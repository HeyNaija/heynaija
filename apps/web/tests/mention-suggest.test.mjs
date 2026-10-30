import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertMention, mentionBeforeCaret, narrow } from '../lib/mention-suggest.ts'

test('a mention is being typed only after an @ standing alone with at least one character', () => {
  assert.deepEqual(mentionBeforeCaret('hi @Ad', 6), { start: 3, query: 'ad' })
  assert.deepEqual(mentionBeforeCaret('@a', 2), { start: 0, query: 'a' })
  assert.equal(mentionBeforeCaret('hi @', 4), null)
  assert.equal(mentionBeforeCaret('ada@example', 11), null)
  assert.equal(mentionBeforeCaret('medium.com/@ada', 15), null)
  assert.equal(mentionBeforeCaret('@ada and', 8), null)
  assert.deepEqual(mentionBeforeCaret('@ada and', 3), { start: 0, query: 'ad' })
})

test('picking a member replaces the whole word and leaves the caret after a space', () => {
  assert.deepEqual(insertMention('hi @ad', { start: 3, query: 'ad' }, 6, 'adaeze'), { text: 'hi @adaeze ', caret: 11 })
  assert.deepEqual(insertMention('@adxx there', { start: 0, query: 'ad' }, 3, 'ada'), { text: '@ada there', caret: 5 })
})

const member = (handle, displayName = null, following = false) => ({ handle, displayName, avatar: null, founder: false, following })

test('a complete shorter answer is narrowed and ordered like the API', () => {
  const known = [member('tunde', 'Tunde Adewale', true), member('ad_b'), member('ada'), member('zee', 'Adaeze'), member('yaw', 'Adaeze')]
  assert.deepEqual(narrow(known, 'ada').map((m) => m.handle), ['ada', 'yaw', 'zee'])
  assert.deepEqual(narrow(known, 'adew').map((m) => m.handle), ['tunde'])
  assert.deepEqual(narrow(known, 'ad').map((m) => m.handle), ['tunde', 'ad_b', 'ada', 'yaw', 'zee'])
})
