import assert from 'node:assert/strict'
import { test } from 'node:test'
import { postedReplyHref } from '../lib/posted-href.ts'

test('a reply posted to a post links to that post', () => {
  assert.equal(postedReplyHref(null, 'r1'), '/p/r1#post-r1')
  assert.equal(postedReplyHref(undefined, 'r1'), '/p/r1#post-r1')
})

test('a reply posted in a Gist links to the Gist, never to /p/, which does not serve it', () => {
  assert.equal(postedReplyHref('g1', 'r1'), '/gists/g1?reply=r1#post-r1')
})
