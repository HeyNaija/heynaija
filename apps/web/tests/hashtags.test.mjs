import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashtagHref, hashtagIn, hashtagKey, isHashtag, tagParam } from '../lib/hashtags.ts'
import { textParts } from '../lib/mentions.ts'

test('hashtags split the text and open the topic as written', () => {
  const text = 'Rain in #Lagos, cc @ada #lagos'
  assert.deepEqual(textParts(text, [{ start: 19, length: 4, handle: 'ada' }], [], [
    { start: 8, length: 6, tag: 'lagos' },
    { start: 24, length: 6, tag: 'lagos' },
  ]), [
    { text: 'Rain in ' },
    { text: '#Lagos', tag: 'Lagos' },
    { text: ', cc ' },
    { text: '@ada', handle: 'ada' },
    { text: ' ' },
    { text: '#lagos', tag: 'lagos' },
  ])
})

test('a hashtag that does not fit the text is left as text', () => {
  const text = 'see #naija'
  for (const bad of [{ start: 3, length: 7 }, { start: 4, length: 1 }, { start: 4, length: 20 }, { start: -1, length: 3 }]) {
    assert.deepEqual(textParts(text, [], [], [{ ...bad, tag: 'naija' }]), [{ text }])
  }
})

test('an address wins over a # inside it', () => {
  const text = 'https://example.com/story#comments'
  assert.deepEqual(
    textParts(text, [], [{ start: 0, length: text.length, url: text }], [{ start: 25, length: 9, tag: 'comments' }]),
    [{ text, href: text, label: 'example.com/story#comments' }],
  )
})

test('topic pages: one address per spelling, one key for all of them', () => {
  assert.equal(hashtagHref('EndSARS'), '/hashtag/EndSARS')
  assert.equal(hashtagHref('Ọ̀ṣun'), `/hashtag/${encodeURIComponent('Ọ̀ṣun')}`)
  assert.equal(hashtagKey('EndSARS'), 'endsars')
  assert.equal(hashtagKey('Kúnlé'), 'kúnlé')
  assert.equal(tagParam(encodeURIComponent('Ọ̀ṣun')), 'Ọ̀ṣun')
  assert.equal(tagParam('naija'), 'naija')
  assert.equal(tagParam('%E0%A4%A'), '%E0%A4%A', 'a broken escape is left alone, and the API finds no such hashtag')
})

test('a search for one hashtag is recognised; anything more is not', () => {
  assert.equal(hashtagIn('#EndSARS'), 'EndSARS')
  assert.equal(hashtagIn('  #naija '), 'naija')
  for (const q of ['naija', '#', '#2027', '#end sars', '#naija #9ja', '##naija']) assert.equal(hashtagIn(q), null, q)
  // A topic page's address is checked the same way, without the #.
  assert.equal(isHashtag('9ja'), true)
  for (const tag of ['', '2027', 'naija ', 'end-sars', 'a'.repeat(51)]) assert.equal(isHashtag(tag), false, tag)
})
