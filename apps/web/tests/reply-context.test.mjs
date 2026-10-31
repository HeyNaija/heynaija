import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replyContextView } from '../lib/reply-context.ts'

const parent = { id: 'p1', authorHandle: 'bayo', authorName: 'Bayo B', authorAvatar: 'a/1', excerpt: 'Start of the parent…' }

test('a post that answers nothing has no reply context', () => {
  assert.deepEqual(replyContextView({ replyParentId: null, replyTo: null }), { kind: 'none' })
})

test('a reply names its parent, links to it and previews it', () => {
  assert.deepEqual(replyContextView({ replyParentId: 'p1', replyTo: parent }), {
    kind: 'parent',
    href: '/p/p1',
    label: 'Replying to @bayo',
    handle: 'bayo',
    name: 'Bayo B',
    avatar: 'a/1',
    excerpt: 'Start of the parent…',
  })
})

test('a parent the reader cannot see says only that it is gone: no link, name or text', () => {
  const view = replyContextView({ replyParentId: 'p1', replyTo: { unavailable: true } })
  assert.deepEqual(view, { kind: 'gone', label: 'Replying to a post that is no longer available' })
})

test('a reply with no parent preview from the API still points at its parent', () => {
  assert.deepEqual(replyContextView({ replyParentId: 'p1', replyTo: undefined }), {
    kind: 'link',
    href: '/p/p1',
    label: 'Replying to a post',
  })
})
