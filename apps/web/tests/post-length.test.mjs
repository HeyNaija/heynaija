import assert from 'node:assert/strict'
import { test } from 'node:test'
import { graphemes, PREVIEW_LINES, PREVIEW_MAX, POST_MAX, previewParts, SHOW_WHOLE_MAX } from '../lib/post-length.ts'

const plain = (text) => [{ text }]
const joined = (parts) => parts.map((part) => part.text).join('')
const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 10}`).join(' ')

test('posts are allowed 1,000 characters', () => {
  assert.equal(POST_MAX, 1000)
})

test('a post within the old 300-character limit, or up to 400, is never shortened', () => {
  for (const text of ['Hello Lagos', 'a'.repeat(300), 'b'.repeat(SHOW_WHOLE_MAX)]) {
    const parts = plain(text)
    const shown = previewParts(parts)
    assert.equal(shown.cut, false)
    assert.equal(shown.parts, parts)
  }
  assert.equal(previewParts(plain('b'.repeat(SHOW_WHOLE_MAX + 1))).cut, true)
})

test('a long post shows its start, ending at a space, with an ellipsis', () => {
  const text = words(200) // about 1,200 characters
  const shown = previewParts(plain(text))
  assert.equal(shown.cut, true)
  const out = joined(shown.parts)
  assert.ok(out.endsWith('…'))
  const start = out.slice(0, -1)
  assert.ok(graphemes(start) <= PREVIEW_MAX)
  assert.ok(text.startsWith(start))
  // The next character of the post is a space: no word was split.
  assert.equal(text[start.length], ' ')
})

test('a mention, hashtag or link that would cross the end is left out whole, never cut', () => {
  const before = 'a '.repeat(147) // 294 characters
  const parts = [
    { text: before },
    { text: '@chiamaka_obi', handle: 'chiamaka_obi' },
    { text: ` and ${words(60)}` },
  ]
  const shown = previewParts(parts)
  assert.equal(shown.cut, true)
  assert.ok(!shown.parts.some((part) => part.handle), 'the mention does not fit, so it is not shown at all')
  assert.ok(!joined(shown.parts).includes('@chia'))

  const link = { text: 'https://heynaija.ng/p/1', href: 'https://heynaija.ng/p/1', label: 'heynaija.ng/p/1' }
  const withLink = previewParts([{ text: 'See ' }, link, { text: ` ${words(100)}` }])
  assert.deepEqual(withLink.parts[1], link, 'a link that fits stays a whole link')
})

test('a post of many short lines shows at most 8 of them', () => {
  const text = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n')
  assert.ok(graphemes(text) < SHOW_WHOLE_MAX)
  const shown = previewParts(plain(text))
  assert.equal(shown.cut, true)
  const lines = joined(shown.parts).slice(0, -1).split('\n')
  assert.equal(lines.length, PREVIEW_LINES)
  assert.equal(lines.at(-1), `line ${PREVIEW_LINES}`)
})

test('an emoji is one character, as the person typing counts it', () => {
  assert.equal(previewParts(plain('🇳🇬'.repeat(SHOW_WHOLE_MAX))).cut, false)
  const shown = previewParts(plain('🇳🇬'.repeat(SHOW_WHOLE_MAX + 1)))
  assert.equal(shown.cut, true)
  // One long run with no space: cut at the limit rather than show nothing.
  assert.equal(graphemes(joined(shown.parts).slice(0, -1)), PREVIEW_MAX)
})
