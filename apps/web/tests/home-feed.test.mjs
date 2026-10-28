import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homeFeed } from '../lib/home-feed.ts'

test('home opens on Discover, unless the address or the last tab chosen says otherwise', () => {
  assert.equal(homeFeed(undefined, undefined, true), 'discover')
  assert.equal(homeFeed(undefined, 'latest', true), 'latest')
  assert.equal(homeFeed('following', 'latest', true), 'following')
  assert.equal(homeFeed('discover', 'latest', true), 'discover')
  assert.equal(homeFeed('nonsense', 'nonsense', true), 'discover')
})

test('Following is only for members; a visitor gets their remembered tab or Discover', () => {
  assert.equal(homeFeed('following', undefined, false), 'discover')
  assert.equal(homeFeed('following', 'latest', false), 'latest')
  assert.equal(homeFeed(undefined, 'following', false), 'discover')
  assert.equal(homeFeed('latest', undefined, false), 'latest')
})
