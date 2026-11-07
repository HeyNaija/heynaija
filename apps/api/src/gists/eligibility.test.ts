import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type AgeStatus, UNKNOWN_AGE } from '../governance/age.js'
import { canHostGist, canJoinGist } from './eligibility.js'

const adult: AgeStatus = { band: '18_plus', assurance: 'declared' }
const ada = { id: 'a', handle: 'ada', active: true, age: adult }
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

test('under 18 and unknown ages may join and listen, but never take the stage', () => {
  for (const age of [{ band: 'under_18', assurance: 'declared' }, { band: 'under_18', assurance: 'verified' }, UNKNOWN_AGE] satisfies AgeStatus[]) {
    const member = { ...ada, age }
    assert.equal(canJoinGist(member, open, { ...allow, inCommunity: false }), true, age.band)
    assert.equal(canHostGist(member, allow), false, age.band)
  }
  assert.equal(canHostGist({ ...ada, age: { band: '18_plus', assurance: 'verified' } }, allow), true)
})

test('a community-only Gist needs community membership', () => {
  const closed = { status: 'live' as const, communityId: 'c' }
  assert.equal(canJoinGist(ada, closed, { ...allow, inCommunity: false }), false)
  assert.equal(canJoinGist(ada, closed, { ...allow, inCommunity: true }), true)
})
