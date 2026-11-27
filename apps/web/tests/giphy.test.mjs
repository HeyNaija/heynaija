import assert from 'node:assert/strict'
import { test } from 'node:test'
import { giphyKeyFrom, giphyMediaUrl, giphyStillUrl, GIPHY_ID } from '../lib/giphy.ts'

test('the media URL is built from the id on the documented media host', () => {
  assert.equal(giphyMediaUrl('xT9IgzoKnwFNmISR8I'), 'https://media1.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.webp')
  assert.equal(giphyStillUrl('xT9IgzoKnwFNmISR8I'), 'https://media1.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy_s.gif')
})

test('an id that could change the URL builds none', () => {
  for (const id of ['', '..', '../x', 'a/b', 'a//b', '//evil.example/x', 'a.webp', 'a b', 'a?x=1', 'a#b', '%2e%2e', 'a\\b', 'é', 'a'.repeat(33), 'a\nb']) {
    assert.equal(giphyMediaUrl(id), null, JSON.stringify(id))
    assert.equal(giphyStillUrl(id), null, JSON.stringify(id))
  }
  assert.ok(giphyMediaUrl('a'.repeat(32)))
})

test('the id pattern is the one the API checks', async () => {
  const { readFile } = await import('node:fs/promises')
  const api = await readFile(new URL('../../api/src/posts/posts.service.ts', import.meta.url), 'utf8')
  assert.ok(api.includes(`export const GIPHY_ID = ${GIPHY_ID}`), 'apps/api posts.service.ts GIPHY_ID differs from lib/giphy.ts')
})

test('the key is trimmed, and an empty or missing one means no Giphy', () => {
  assert.equal(giphyKeyFrom('  abc123  '), 'abc123')
  for (const raw of [undefined, '', '   ']) assert.equal(giphyKeyFrom(raw), null)
})
