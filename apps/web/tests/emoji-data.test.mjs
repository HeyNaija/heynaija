import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMOJI_GROUPS, emojiFor, searchEmoji } from '../lib/emoji-data.ts'

const all = EMOJI_GROUPS.flatMap((group) => group.emoji)
const graphemes = (text) => [...new Intl.Segmenter().segment(text)].length

test('every emoji is one character with a name, and none is listed twice', () => {
  for (const e of all) {
    assert.equal(graphemes(e.char), 1, e.char)
    assert.ok(e.name.length > 0, e.char)
  }
  assert.equal(new Set(all.map((e) => e.char)).size, all.length)
})

test('whole sequences are kept: a ZWJ family, a flag, a skin tone', () => {
  for (const char of ['👨‍👩‍👧', '🇳🇬', '👍🏽']) assert.equal(emojiFor(char)?.char, char)
})

test('search finds by name or search word, every word of the query, any case', () => {
  assert.deepEqual(searchEmoji('Naija').map((e) => e.char), ['🇳🇬'])
  assert.ok(searchEmoji('grinning').some((e) => e.char === '😀'))
  assert.deepEqual(searchEmoji('thumbs medium').map((e) => e.char), ['👍🏽'])
  assert.deepEqual(searchEmoji('   '), [])
  assert.deepEqual(searchEmoji('zzzzqqq'), [])
})
