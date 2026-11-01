import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canHostGist, canJoinGist } from './eligibility.js'

const ada = { id: 'a', handle: 'ada', active: true }
const open = { status: 'live' as const, communityId: null }
const allow = { callsMembers: ['ada'] }

test('only handles on the beta allow-list may join or host', () => {
  assert.equal(canJoinGist(ada, open, { ...allow, inCommunity: false }), true)
  assert.equal(canHostGist(ada, allow), true)
  assert.equal(canJoinGist({ ...ada, handle: 'bayo' }, open, { ...allow, inCommunity: false }), false)
  assert.equal(canHostGist({ ...ada, handle: 'bayo' }, allow), false)
  assert.equal(canHostGist(ada, { callsMembers: [] }), false)
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
