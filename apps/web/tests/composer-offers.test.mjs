import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composerOffers } from '../lib/composer-offers.ts'

const all = { media: true, polls: true, videoAvailable: true, replyTo: undefined, pollOpen: false, videoDrafted: false }

test('a new post can carry pictures, a video and a poll', () => {
  assert.deepEqual(composerOffers(all), { pictures: true, video: true, poll: true, gifSearch: false, pictureFiles: true })
})

test('a reply carries pictures but no video or poll', () => {
  assert.deepEqual(composerOffers({ ...all, replyTo: 'p1' }), { pictures: true, video: false, poll: false, gifSearch: false, pictureFiles: true })
})

test('a text-only composer, like a Gist reply, offers no pictures, GIFs or video', () => {
  assert.deepEqual(composerOffers({ ...all, media: false }), { pictures: false, video: false, poll: true, gifSearch: false, pictureFiles: false })
  assert.deepEqual(composerOffers({ ...all, media: false, replyTo: 'g1' }), { pictures: false, video: false, poll: false, gifSearch: false, pictureFiles: false })
})

test('a poll and a video exclude each other', () => {
  assert.equal(composerOffers({ ...all, pollOpen: true }).video, false)
  assert.equal(composerOffers({ ...all, videoDrafted: true }).poll, false)
})

const withGifs = { ...all, gifAvailable: true, gifDrafted: false, imagesDrafted: false }

test('the GIF search is offered on a new post and on a reply, when a provider is available', () => {
  assert.equal(composerOffers(withGifs).gifSearch, true)
  assert.equal(composerOffers({ ...withGifs, replyTo: 'p1' }).gifSearch, true)
})

test('no provider, key or flag, no GIF search', () => {
  assert.equal(composerOffers({ ...withGifs, gifAvailable: false }).gifSearch, false)
  assert.equal(composerOffers(all).gifSearch, false)
})

test('a text-only composer, like a Gist reply, has no GIF search', () => {
  assert.equal(composerOffers({ ...withGifs, media: false }).gifSearch, false)
})

test('a picked GIF excludes uploaded pictures, a video and a poll, and they exclude it', () => {
  assert.equal(composerOffers({ ...withGifs, imagesDrafted: true }).gifSearch, false)
  assert.equal(composerOffers({ ...withGifs, videoDrafted: true }).gifSearch, false)
  assert.equal(composerOffers({ ...withGifs, pollOpen: true }).gifSearch, false)
  const drafted = composerOffers({ ...withGifs, gifDrafted: true })
  assert.deepEqual(drafted, { pictures: true, video: false, poll: false, gifSearch: false, pictureFiles: false })
})

test('only one GIF a post: with one drafted the search is not offered again', () => {
  assert.equal(composerOffers({ ...withGifs, gifDrafted: true }).gifSearch, false)
})
