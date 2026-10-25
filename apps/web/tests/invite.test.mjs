import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normaliseCode, readDraft } from '../lib/invite.ts'

test('an invite code keeps only its letters and digits, in capitals', () => {
  assert.equal(normaliseCode(' hn-ab12-cd34-ef56 '), 'HNAB12CD34EF56')
  assert.equal(normaliseCode('HN-AB12;path=/'), 'HNAB12PATH')
})

test('what was typed on /signup comes back from its cookie, and nothing else does', () => {
  const typed = { code: 'HN-AB12', adult: true, email: 'ada@example.test', handle: 'ada' }
  assert.deepEqual(readDraft(JSON.stringify(typed)), typed)
  assert.deepEqual(readDraft(JSON.stringify({ code: 7, adult: 'yes', admin: true })), {
    code: undefined,
    adult: false,
    email: undefined,
    handle: undefined,
  })
  assert.deepEqual(readDraft('not json'), {})
  assert.deepEqual(readDraft(undefined), {})
})
