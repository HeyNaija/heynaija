import assert from 'node:assert/strict'
import { test } from 'node:test'
import { quoteMedia } from '../lib/quote-media.ts'

const quote = { images: [], gif: null, hasVideo: false, coverMedia: false }
const picture = { src: '/media/posts/m1', alt: 'A market', width: 10, height: 10, animated: false }
const gif = { provider: 'giphy', id: 'abc123', alt: 'A cat waving' }

test('a quoted post of words alone shows nothing more', () => {
  assert.equal(quoteMedia(quote, false), null)
})

test("a quoted GIF shows its first frame, never the animation, without a referrer's help", () => {
  assert.deepEqual(quoteMedia({ ...quote, gif }, false), { kind: 'gif', src: 'https://media1.giphy.com/media/abc123/giphy_s.gif', alt: 'A cat waving' })
})

test('a quoted GIF from a provider this app does not know says so, and builds no address', () => {
  assert.deepEqual(quoteMedia({ ...quote, gif: { provider: 'testgif', id: 'tg-1', alt: '' } }, false), { kind: 'note', text: 'GIF unavailable.' })
})

test('saving data, a quoted GIF waits like pictures do', () => {
  assert.deepEqual(quoteMedia({ ...quote, gif }, true), { kind: 'note', text: 'GIF not loaded. Open the post to load.' })
  assert.deepEqual(quoteMedia({ ...quote, images: [picture, picture] }, true), { kind: 'note', text: '2 images not loaded. Open the post to load.' })
})

test('behind a cover, nothing of a GIF, a video or pictures shows', () => {
  for (const covered of [{ gif }, { hasVideo: true }, { images: [picture] }]) {
    assert.deepEqual(quoteMedia({ ...quote, ...covered, coverMedia: true }, false), { kind: 'note', text: 'Sensitive content. Open the post to see it.' })
  }
})

test('a quoted video is named, not played', () => {
  assert.deepEqual(quoteMedia({ ...quote, hasVideo: true }, false), { kind: 'note', text: 'Video. Open the post to watch it.' })
})

test('quoted pictures show as before', () => {
  assert.deepEqual(quoteMedia({ ...quote, images: [picture] }, false), { kind: 'images' })
})
