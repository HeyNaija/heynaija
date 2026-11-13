import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notificationTarget } from '../lib/notification-target.ts'
import { gistReplyHref } from '../lib/thread-state.ts'

const notification = (kind, fields = {}) => ({ kind, post: null, actor: null, community: null, ...fields })

test('post notifications open the exact post or reply, with an anchor', () => {
  for (const kind of ['reply', 'like', 'repost', 'quote', 'mention', 'post_restored']) {
    assert.equal(notificationTarget(notification(kind, { post: { id: 'reply-id', excerpt: 'hello' } })), '/p/reply-id#post-reply-id')
  }
})

test('follow notifications open the person who followed you', () => {
  assert.equal(notificationTarget(notification('follow', { actor: { handle: 'ada' } })), '/u/ada')
})

test('missing or unavailable targets do not produce broken links', () => {
  for (const kind of ['reply', 'like', 'repost', 'quote', 'mention', 'post_restored', 'follow', 'moderator_revoked']) {
    assert.equal(notificationTarget(notification(kind)), null)
  }
})

test('moderation notifications open the relevant actionable screen', () => {
  assert.equal(notificationTarget(notification('avatar_removed')), '/settings')
  assert.equal(notificationTarget(notification('profile_cleared')), '/settings')
  assert.equal(notificationTarget(notification('moderator_granted')), '/mod')
  assert.equal(notificationTarget(notification('moderator_revoked', { community: { slug: 'lagos' } })), '/c/lagos')
})

test('informational moderation outcomes remain readable without a misleading destination', () => {
  for (const kind of ['post_removed', 'report_resolved', 'account_reinstated']) {
    assert.equal(notificationTarget(notification(kind)), null)
  }
})

test('a chess challenge opens it on the chess page', () => {
  assert.equal(notificationTarget(notification('chess_challenge', { challenge: { id: 'c1', phrase: 'x' } })), '/games/chess#challenge-c1')
  assert.equal(notificationTarget(notification('chess_challenge')), '/games/chess')
})

test('a reply in a Gist opens the Gist page at the reply, not a post page the reader cannot open', () => {
  assert.equal(
    notificationTarget(notification('reply', { post: { id: 'reply-id', excerpt: 'hello', gistId: 'gist-id' } })),
    '/gists/gist-id?reply=reply-id#post-reply-id',
  )
  assert.equal(
    notificationTarget(notification('reply', { post: { id: 'reply-id', excerpt: 'hello', gistId: null } })),
    '/p/reply-id#post-reply-id',
  )
})

test('a reply nested under another reply opens that reply as the conversation in focus, which the page can always render', () => {
  const nested = notification('mention', { post: { id: 'r2', excerpt: 'hi', gistId: 'g1' } })
  assert.equal(notificationTarget(nested), '/gists/g1?reply=r2#post-r2')
  assert.equal(notificationTarget(nested), gistReplyHref('g1', 'r2'))
})
