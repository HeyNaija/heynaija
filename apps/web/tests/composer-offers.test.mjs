import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composerOffers } from '../lib/composer-offers.ts'

const all = { media: true, polls: true, videoAvailable: true, replyTo: undefined, pollOpen: false, videoDrafted: false }

test('a new post can carry pictures, a video and a poll', () => {
  assert.deepEqual(composerOffers(all), { pictures: true, video: true, poll: true })
})

test('a reply carries pictures but no video or poll', () => {
  assert.deepEqual(composerOffers({ ...all, replyTo: 'p1' }), { pictures: true, video: false, poll: false })
})

test('a text-only composer, like a Gist reply, offers no pictures, GIFs or video', () => {
  assert.deepEqual(composerOffers({ ...all, media: false }), { pictures: false, video: false, poll: true })
  assert.deepEqual(composerOffers({ ...all, media: false, replyTo: 'g1' }), { pictures: false, video: false, poll: false })
})

test('a poll and a video exclude each other', () => {
  assert.equal(composerOffers({ ...all, pollOpen: true }).video, false)
  assert.equal(composerOffers({ ...all, videoDrafted: true }).poll, false)
})
