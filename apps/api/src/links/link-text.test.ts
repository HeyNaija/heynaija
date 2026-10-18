import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findLinks, previewUrlOf } from './link-text.js'

const urls = (text: string) => findLinks(text).map((l) => l.url)
const spans = (text: string) => findLinks(text).map((l) => text.slice(l.start, l.start + l.length))

test('finds web addresses with a scheme or www, and says where they are', () => {
  const text = 'read https://example.com/a?b=1 and www.example.ng today'
  assert.deepEqual(urls(text), ['https://example.com/a?b=1', 'https://www.example.ng/'])
  assert.deepEqual(spans(text), ['https://example.com/a?b=1', 'www.example.ng'])
})

test('the sentence around an address is not part of it', () => {
  assert.deepEqual(spans('see https://example.com/a.'), ['https://example.com/a'])
  assert.deepEqual(spans('(https://example.com/a), then'), ['https://example.com/a'])
  assert.deepEqual(spans('"https://example.com/a!"'), ['https://example.com/a'])
  assert.deepEqual(spans('wow https://example.com/a?!'), ['https://example.com/a'])
})

test('a bracket that belongs to the address stays', () => {
  assert.deepEqual(spans('https://en.wikipedia.org/wiki/Nigeria_(country)'), ['https://en.wikipedia.org/wiki/Nigeria_(country)'])
  assert.deepEqual(spans('(see https://en.wikipedia.org/wiki/Nigeria_(country))'), ['https://en.wikipedia.org/wiki/Nigeria_(country)'])
})

test('only http and https are links', () => {
  assert.deepEqual(urls('javascript:alert(1) ftp://example.com data:text/html,hi mailto:a@example.com'), [])
  assert.deepEqual(urls('HTTPS://EXAMPLE.COM/Path'), ['https://example.com/Path'])
})

test('things that only look like addresses are left as text', () => {
  assert.deepEqual(urls('http://localhost:3000 http://192.168.0.1/admin http://[::1]/ https://intranet/x'), [])
  assert.deepEqual(urls('mail ada@www.example.com or notwww.example.com or a/www.example.com'), [])
  assert.deepEqual(urls('version v1.2.3 and index.js'), [])
})

test('an address with a login in it is not linked: it reads as one site and leads to another', () => {
  assert.deepEqual(urls('https://paypal.com@evil.example/login'), [])
})

test('non-Latin hosts are linked in their punycode form', () => {
  assert.deepEqual(urls('https://bücher.example/'), ['https://xn--bcher-kva.example/'])
})

test('an address over the length limit is left as text', () => {
  assert.deepEqual(urls(`https://example.com/${'a'.repeat(2100)}`), [])
})

test('offsets count UTF-16 code units, as for mentions', () => {
  const text = '🇳🇬 https://example.com'
  const [link] = findLinks(text)
  assert.equal(text.slice(link!.start, link!.start + link!.length), 'https://example.com')
})

test('the preview is for the first address, without its fragment', () => {
  assert.equal(previewUrlOf('one https://example.com/a#top two https://example.org/b'), 'https://example.com/a')
  assert.equal(previewUrlOf('no address here'), null)
  assert.equal(previewUrlOf(''), null)
})
