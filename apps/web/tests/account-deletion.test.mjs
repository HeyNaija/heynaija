import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cancelAnswer, deletionAnswer, REFUSALS, refusalPath, scheduledDate } from '../lib/account-deletion.ts'

test('a deletion request is scheduled, sent to sign in again, or explained', () => {
  const at = '2026-11-13T09:00:00.000Z'
  assert.deepEqual(deletionAnswer(200, { state: 'scheduled', scheduledFor: at }), { kind: 'scheduled', scheduledFor: at })
  assert.deepEqual(deletionAnswer(403, { code: 'reauth_required' }), { kind: 'reauth' })
  assert.deepEqual(deletionAnswer(401, {}), { kind: 'signed_out' })
  assert.match(deletionAnswer(400, { code: 'handle_mismatch' }).message, /not your handle/)
  assert.equal(deletionAnswer(400, { code: 'handle_mismatch' }).refusal, 'handle')
  assert.match(deletionAnswer(403, { code: 'site_moderator' }).message, /moderator/)
  assert.equal(deletionAnswer(403, { code: 'site_moderator' }).refusal, 'moderator')
  assert.match(deletionAnswer(429, { code: 'rate_limited' }).message, /Wait an hour/)
  assert.equal(deletionAnswer(429, { code: 'rate_limited' }).refusal, 'busy')
  assert.equal(deletionAnswer(503, {}).refusal, 'unavailable')
  // A 403 that is not about signing in again is never taken for one.
  assert.equal(deletionAnswer(403, { message: 'account_inactive' }).kind, 'error')
  // Neither is a 200 without a date.
  assert.equal(deletionAnswer(200, {}).kind, 'error')
  assert.equal(deletionAnswer(503, {}).kind, 'error')
})

test('every refusal has a message and a page of its own', () => {
  for (const [refusal, message] of Object.entries(REFUSALS)) {
    assert.ok(message.length > 0, refusal)
    assert.equal(refusalPath(refusal), `/settings/delete/refused/${refusal}`)
  }
  for (const status of [400, 403, 429, 500]) {
    const answer = deletionAnswer(status, {})
    assert.equal(answer.kind, 'error')
    assert.equal(answer.message, REFUSALS[answer.refusal])
  }
})

test('cancelling succeeds, is too late, or is explained', () => {
  assert.equal(cancelAnswer(204, {}), null)
  assert.deepEqual(cancelAnswer(401, {}), { kind: 'signed_out' })
  assert.match(cancelAnswer(409, { code: 'too_late' }).message, /too late/)
  assert.match(cancelAnswer(429, {}).message, /Wait an hour/)
  assert.equal(cancelAnswer(500, {}).kind, 'error')
})

test('the date cookie is read only when it holds a date as the API writes it', () => {
  assert.equal(scheduledDate('2026-11-13T09:00:00.000Z'), '2026-11-13T09:00:00.000Z')
  assert.equal(scheduledDate('2026-11-13T09:00:00Z'), '2026-11-13T09:00:00.000Z')
  for (const value of [undefined, '', 'tomorrow', '2026-11-13', '2026-13-45T09:00:00Z', '2026-11-13T09:00:00Z<script>']) {
    assert.equal(scheduledDate(value), null, String(value))
  }
})
