import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canHostGist, canJoinGist } from './eligibility.js'

const ada = { id: 'a', handle: 'ada', active: true }
const open = { status: 'live' as const, communityId: null }
const allow = { allowed: (memberId: string) => memberId === 'a' }

test('only members the gists flag is on for may join or host', () => {
  assert.equal(canJoinGist(ada, open, { ...allow, inCommunity: false }), true)
  assert.equal(canHostGist(ada, allow), true)
  assert.equal(canJoinGist({ ...ada, id: 'b', handle: 'bayo' }, open, { ...allow, inCommunity: false }), false)
  assert.equal(canHostGist({ ...ada, id: 'b', handle: 'bayo' }, allow), false)
  assert.equal(canHostGist(ada, { allowed: () => false }), false)
})

test('a suspended member can neither join nor host', () => {
  assert.equal(canJoinGist({ ...ada, active: false }, open, { ...allow, inCommunity: false }), false)
  assert.equal(canHostGist({ ...ada, active: false }, allow), false)
})

test('a community-only Gist needs community membership', () => {
  const closed = { status: 'live' as const, communityId: 'c' }
  assert.equal(canJoinGist(ada, closed, { ...allow, inCommunity: false }), false)
  assert.equal(canJoinGist(ada, closed, { ...allow, inCommunity: true }), true)
})
