import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gifPlaying } from '../lib/gif-motion.ts'
import { giphySource } from '../lib/giphy.ts'

test('a GIF plays on its own unless the device asks for less motion', () => {
  assert.equal(gifPlaying(null, false), true)
  assert.equal(gifPlaying(null, true), false)
})

test('the reader\'s own choice beats the device setting, either way', () => {
  assert.equal(gifPlaying(true, true), true, 'Play pressed under reduced motion')
  assert.equal(gifPlaying(false, false), false, 'Pause pressed')
})

test('a Giphy GIF shows its animation while playing and its first frame while paused', () => {
  assert.equal(giphySource('abc123', true), 'https://media1.giphy.com/media/abc123/giphy.webp')
  assert.equal(giphySource('abc123', false), 'https://media1.giphy.com/media/abc123/giphy_s.gif')
})

test('a malformed id has no source, playing or paused', () => {
  assert.equal(giphySource('../x', true), null)
  assert.equal(giphySource('../x', false), null)
})
