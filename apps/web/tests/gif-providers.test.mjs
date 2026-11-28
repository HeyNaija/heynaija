import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { composerGif } from '../lib/gif/composer.ts'
import { giphy } from '../lib/gif/giphy.ts'
import { GIF_PROVIDERS, gifMedia, gifProvider } from '../lib/gif/providers.ts'

const ID = 'xT9IgzoKnwFNmISR8I'
const HOSTILE_IDS = ['', '..', '../x', 'a/b', 'a//b', '//evil.example/x', 'a.webp', 'a b', 'a?x=1', 'a#b', '%2e%2e', 'a\\b', 'é', 'a'.repeat(33), 'a\nb']

/** A stand-in provider, only for tests: proves a second one goes through the same lookups. */
const testgif = {
  id: 'testgif',
  label: 'TestGIF',
  idPattern: /^tg-[0-9]{1,6}$/,
  searchPlaceholder: 'Search TestGIF',
  attribution: 'Powered by TestGIF',
  credit: 'GIF via TestGIF',
  media: (id) => (/^tg-[0-9]{1,6}$/.test(id) ? { animatedUrl: `https://media.testgif.example/${id}.webp`, stillUrl: `https://media.testgif.example/${id}_s.webp` } : null),
  search: async () => async () => ({ found: [], next: null }),
}
const both = { ...GIF_PROVIDERS, testgif }

test("GIPHY's media is built from the id on its documented media host", () => {
  assert.deepEqual(gifMedia({ provider: 'giphy', id: ID }), {
    provider: giphy,
    animatedUrl: `https://media1.giphy.com/media/${ID}/giphy.webp`,
    stillUrl: `https://media1.giphy.com/media/${ID}/giphy_s.gif`,
  })
})

test('a GIPHY id that could change the URL builds none', () => {
  for (const id of HOSTILE_IDS) assert.equal(gifMedia({ provider: 'giphy', id }), null, JSON.stringify(id))
  assert.ok(gifMedia({ provider: 'giphy', id: 'a'.repeat(32) }))
})

test('a provider this app does not know builds no URL: the post shows "GIF unavailable"', () => {
  for (const provider of ['testgif', 'klipy', 'GIPHY', '', '../giphy', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(gifProvider(provider), null, provider)
    assert.equal(gifMedia({ provider, id: ID }), null, provider)
  }
})

test('a second provider renders through the same lookup, by its own tag and id rule', () => {
  assert.deepEqual(gifMedia({ provider: 'testgif', id: 'tg-42' }, both), {
    provider: testgif,
    animatedUrl: 'https://media.testgif.example/tg-42.webp',
    stillUrl: 'https://media.testgif.example/tg-42_s.webp',
  })
  assert.equal(gifMedia({ provider: 'testgif', id: ID }, both), null)
  assert.equal(gifMedia({ provider: 'giphy', id: 'tg-42' }, both), null)
  assert.ok(gifMedia({ provider: 'giphy', id: ID }, both))
})

test("each provider's id rule is the one the API checks", async () => {
  const api = await readFile(new URL('../../api/src/gifs/registry.ts', import.meta.url), 'utf8')
  for (const [name, provider] of Object.entries(GIF_PROVIDERS)) {
    assert.ok(api.includes(`${name}: { label: '${provider.label}', id: ${provider.idPattern},`), `apps/api/src/gifs/registry.ts has a different ${name} id rule`)
  }
})

test('the composer offers GIPHY when no provider is named, and only with its key', () => {
  for (const provider of [undefined, '', '  ']) {
    assert.deepEqual(composerGif({ provider, keys: { giphy: ' abc123 ' } }), { provider: giphy, apiKey: 'abc123' }, JSON.stringify(provider))
  }
  for (const key of [undefined, '', '   ']) assert.equal(composerGif({ provider: 'giphy', keys: { giphy: key } }), null, JSON.stringify(key))
})

test('naming another provider changes what the composer offers, and old GIPHY posts still render', () => {
  assert.deepEqual(composerGif({ provider: 'testgif', keys: { giphy: 'abc', testgif: 'k' } }, both), { provider: testgif, apiKey: 'k' })
  assert.equal(composerGif({ provider: 'testgif', keys: { giphy: 'abc' } }, both), null, 'no key for it, no search')
  assert.ok(gifMedia({ provider: 'giphy', id: ID }, both), 'a GIPHY post is drawn by its own tag, whatever the composer offers')
})

test('a provider name the app does not know offers no search, rather than falling back to another', () => {
  for (const provider of ['klipy', 'tenor', 'GIPHY', 'constructor']) {
    assert.equal(composerGif({ provider, keys: { giphy: 'abc' } }), null, provider)
  }
})
