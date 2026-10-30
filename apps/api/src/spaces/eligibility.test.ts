import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canHostSpace, canJoinSpace } from './eligibility.js'

const ada = { id: 'a', handle: 'ada', active: true }
const open = { status: 'live' as const, communityId: null }
const allow = { callsMembers: ['ada'] }

test('only handles on the beta allow-list may join or host', () => {
  assert.equal(canJoinSpace(ada, open, { ...allow, inCommunity: false }), true)
  assert.equal(canHostSpace(ada, allow), true)
  assert.equal(canJoinSpace({ ...ada, handle: 'bayo' }, open, { ...allow, inCommunity: false }), false)
  assert.equal(canHostSpace({ ...ada, handle: 'bayo' }, allow), false)
  assert.equal(canHostSpace(ada, { callsMembers: [] }), false)
})

test('a suspended member can neither join nor host', () => {
  assert.equal(canJoinSpace({ ...ada, active: false }, open, { ...allow, inCommunity: false }), false)
  assert.equal(canHostSpace({ ...ada, active: false }, allow), false)
})

test('a community-only Space needs community membership', () => {
  const closed = { status: 'live' as const, communityId: 'c' }
  assert.equal(canJoinSpace(ada, closed, { ...allow, inCommunity: false }), false)
  assert.equal(canJoinSpace(ada, closed, { ...allow, inCommunity: true }), true)
})
