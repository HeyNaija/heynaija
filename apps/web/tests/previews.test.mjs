import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultPreviewImage, postPreview } from '../lib/previews.ts'

const picture = { src: '/media/posts/m1', alt: 'The market at dusk', width: 1600, height: 1200, animated: false }
const post = { text: 'Evening in Balogun', authorHandle: 'ada', sensitive: null, images: [picture], video: null, gif: null }

test("a post's link shows its text and its first picture at 640px", () => {
  assert.deepEqual(postPreview(post), {
    description: 'Evening in Balogun',
    image: { url: '/media/posts/m1/640.webp', width: 640, height: 480, alt: 'The market at dusk' },
  })
})

test("a GIF's link shows its first frame, and a post of pictures alone says how many", () => {
  const gif = { ...picture, animated: true, width: 400, height: 300 }
  assert.deepEqual(postPreview({ ...post, text: '', images: [gif, picture] }), {
    description: '@ada shared 2 photos.',
    image: { url: '/media/posts/m1/still.webp', width: 400, height: 300, alt: 'The market at dusk' },
  })
})

test('a post of a GIF alone says it shared a GIF, with the default picture, whatever its provider', () => {
  for (const provider of ['giphy', 'testgif']) {
    assert.deepEqual(postPreview({ ...post, text: '', images: [], gif: { provider, id: 'xT9IgG50Fb7Mi0prBC', alt: 'A cat waving' } }), {
      description: '@ada shared a GIF.',
      image: defaultPreviewImage,
    })
  }
})

test('a post of a video alone says it shared a video, with the default picture', () => {
  assert.deepEqual(postPreview({ ...post, text: '', images: [], video: { id: 'v1' } }), {
    description: '@ada shared a video.',
    image: defaultPreviewImage,
  })
})

test('a post with no words and nothing ready to show says it shared a post, not "0 photos"', () => {
  assert.deepEqual(postPreview({ ...post, text: '', images: [] }), {
    description: '@ada shared a post.',
    image: defaultPreviewImage,
  })
})

test('a post marked sensitive puts neither its text nor its signed picture in the tags', () => {
  const signed = { ...picture, src: '/api/v1/media/private/1794070800/sig/posts/m1' }
  for (const sensitive of ['author', 'moderator']) {
    const preview = postPreview({ ...post, sensitive, images: [signed] })
    assert.deepEqual(preview, { description: undefined, image: defaultPreviewImage })
    assert.ok(!JSON.stringify(preview).includes('private'))
  }
})
