import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composerOffers } from '../lib/composer-offers.ts'

const all = { media: true, polls: true, videoAvailable: true, replyTo: undefined, pollOpen: false, videoDrafted: false }

test('a new post can carry pictures, a video and a poll', () => {
  assert.deepEqual(composerOffers(all), { pictures: true, video: true, poll: true, giphy: false, pictureFiles: true })
})

test('a reply carries pictures but no video or poll', () => {
  assert.deepEqual(composerOffers({ ...all, replyTo: 'p1' }), { pictures: true, video: false, poll: false, giphy: false, pictureFiles: true })
})

test('a text-only composer, like a Gist reply, offers no pictures, GIFs or video', () => {
  assert.deepEqual(composerOffers({ ...all, media: false }), { pictures: false, video: false, poll: true, giphy: false, pictureFiles: false })
  assert.deepEqual(composerOffers({ ...all, media: false, replyTo: 'g1' }), { pictures: false, video: false, poll: false, giphy: false, pictureFiles: false })
})

test('a poll and a video exclude each other', () => {
  assert.equal(composerOffers({ ...all, pollOpen: true }).video, false)
  assert.equal(composerOffers({ ...all, videoDrafted: true }).poll, false)
})

const withGiphy = { ...all, giphyAvailable: true, giphyDrafted: false, imagesDrafted: false }

test('the Giphy picker is offered on a new post and on a reply, when Giphy is available', () => {
  assert.equal(composerOffers(withGiphy).giphy, true)
  assert.equal(composerOffers({ ...withGiphy, replyTo: 'p1' }).giphy, true)
})

test('no key or flag, no Giphy picker', () => {
  assert.equal(composerOffers({ ...withGiphy, giphyAvailable: false }).giphy, false)
  assert.equal(composerOffers(all).giphy, false)
})

test('a text-only composer, like a Gist reply, has no Giphy picker', () => {
  assert.equal(composerOffers({ ...withGiphy, media: false }).giphy, false)
})

test('a Giphy GIF excludes uploaded pictures, a video and a poll, and they exclude it', () => {
  assert.equal(composerOffers({ ...withGiphy, imagesDrafted: true }).giphy, false)
  assert.equal(composerOffers({ ...withGiphy, videoDrafted: true }).giphy, false)
  assert.equal(composerOffers({ ...withGiphy, pollOpen: true }).giphy, false)
  const drafted = composerOffers({ ...withGiphy, giphyDrafted: true })
  assert.deepEqual(drafted, { pictures: true, video: false, poll: false, giphy: false, pictureFiles: false })
})

test('only one Giphy GIF a post: with one drafted the picker is not offered again', () => {
  assert.equal(composerOffers({ ...withGiphy, giphyDrafted: true }).giphy, false)
})
