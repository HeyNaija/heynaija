import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composerContent } from '../lib/composer-required.ts'

const bare = { text: '', images: 0, video: false, gif: false, pollOpen: false }

test('a box with nothing in it is empty and needs words', () => {
  assert.deepEqual(composerContent(bare), { empty: true, textRequired: true })
  assert.deepEqual(composerContent({ ...bare, text: '  \n ' }), { empty: true, textRequired: true })
})

test('words alone make a post', () => {
  assert.deepEqual(composerContent({ ...bare, text: 'How far' }), { empty: false, textRequired: true })
})

test('pictures alone make a post, with no words needed', () => {
  assert.deepEqual(composerContent({ ...bare, images: 2 }), { empty: false, textRequired: false })
})

test('a video alone makes a post, with no words needed', () => {
  assert.deepEqual(composerContent({ ...bare, video: true }), { empty: false, textRequired: false })
})

test('a Giphy GIF alone makes a post, with no words needed', () => {
  assert.deepEqual(composerContent({ ...bare, gif: true }), { empty: false, textRequired: false })
})

test('a poll needs its question, with or without pictures', () => {
  assert.deepEqual(composerContent({ ...bare, pollOpen: true }), { empty: true, textRequired: true })
  assert.deepEqual(composerContent({ ...bare, pollOpen: true, images: 1 }), { empty: false, textRequired: true })
})

test('whenever the box is not empty and has no words, words are not required, so the browser never blocks a post the button allows', () => {
  for (const images of [0, 1]) {
    for (const video of [false, true]) {
      for (const gif of [false, true]) {
        const rule = composerContent({ text: '', images, video, gif, pollOpen: false })
        assert.equal(rule.textRequired, rule.empty, JSON.stringify({ images, video, gif }))
      }
    }
  }
})
