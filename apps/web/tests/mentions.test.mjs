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

test('a web address is linked, with a shorter label on screen', () => {
  const text = 'read https://www.example.com/a/very/long/path/that/goes/on/and/on.html? now'
  const parts = textParts(text, [], [{ start: 5, length: 67, url: 'https://www.example.com/a/very/long/path/that/goes/on/and/on.html' }])
  assert.equal(parts.length, 3)
  assert.equal(parts[1].href, 'https://www.example.com/a/very/long/path/that/goes/on/and/on.html')
  assert.equal(parts[1].text, text.slice(5, 72))
  assert.equal(parts[1].label.length, 32)
  assert.ok(parts[1].label.startsWith('example.com/a/very/long/path'))
  assert.ok(parts[1].label.endsWith('…'))
})

test('an address that fits keeps its whole text apart from the scheme and www', () => {
  const [, link] = textParts('see www.example.ng/ok', [], [{ start: 4, length: 17, url: 'https://www.example.ng/ok' }])
  assert.deepEqual(link, { text: 'www.example.ng/ok', href: 'https://www.example.ng/ok', label: 'example.ng/ok' })
})

test('mentions and addresses sit side by side, and an @handle inside an address belongs to it', () => {
  const text = '@ada: https://example.com/?u=@bayo and @bayo'
  const parts = textParts(
    text,
    [
      { start: 0, length: 4, handle: 'ada' },
      { start: 29, length: 5, handle: 'bayo' }, // inside the address: dropped
      { start: 39, length: 5, handle: 'bayo' },
    ],
    [{ start: 6, length: 28, url: 'https://example.com/?u=@bayo' }],
  )
  assert.deepEqual(parts.map((p) => p.handle ?? p.href ?? p.text), ['ada', ': ', 'https://example.com/?u=@bayo', ' and ', 'bayo'])
})

test('only web addresses are ever linked', () => {
  const text = 'javascript:alert(1) and https://example.com'
  assert.deepEqual(textParts(text, [], [{ start: 0, length: 19, url: 'javascript:alert(1)' }]), [{ text }])
  assert.deepEqual(textParts(text, [], [{ start: 0, length: 19, url: 'https://example.com' }]), [{ text }], 'the text must be an address too')
})
