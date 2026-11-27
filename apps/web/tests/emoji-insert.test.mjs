import assert from 'node:assert/strict'
import { test } from 'node:test'
import { insertAtSelection } from '../lib/emoji-insert.ts'

const family = '👨‍👩‍👧'
const flag = '🇳🇬'
const thumb = '👍🏽'

test('an emoji goes in an empty box, caret after it', () => {
  assert.deepEqual(insertAtSelection('', 0, 0, '😀'), { value: '😀', caret: 2 })
})

test('an emoji goes in at the caret: start, middle and end', () => {
  assert.deepEqual(insertAtSelection('abc', 0, 0, '😀'), { value: '😀abc', caret: 2 })
  assert.deepEqual(insertAtSelection('abc', 1, 1, '😀'), { value: 'a😀bc', caret: 3 })
  assert.deepEqual(insertAtSelection('abc', 3, 3, '😀'), { value: 'abc😀', caret: 5 })
})

test('a selected range is replaced, whichever way it was selected', () => {
  assert.deepEqual(insertAtSelection('hello world', 6, 11, '🎉'), { value: 'hello 🎉', caret: 8 })
  assert.deepEqual(insertAtSelection('hello world', 11, 6, '🎉'), { value: 'hello 🎉', caret: 8 })
})

test('a ZWJ sequence, a flag and a skin tone go in whole, the caret after all of it', () => {
  for (const emoji of [family, flag, thumb]) {
    const out = insertAtSelection('ab', 1, 1, emoji)
    assert.equal(out.value, `a${emoji}b`)
    assert.equal(out.caret, 1 + emoji.length)
    assert.equal([...new Intl.Segmenter().segment(out.value)].length, 3)
  }
})

test('a caret inside an emoji already written never splits it', () => {
  const text = `${family}${thumb}`
  const inside = insertAtSelection(text, 3, 3, '😀')
  assert.equal(inside.value, `😀${family}${thumb}`)
  const inThumb = insertAtSelection(text, family.length + 2, family.length + 2, '😀')
  assert.equal(inThumb.value, `${family}😀${thumb}`)
  const range = insertAtSelection(`a${flag}b`, 2, 4, '😀')
  assert.equal(range.value, 'a😀b')
})
