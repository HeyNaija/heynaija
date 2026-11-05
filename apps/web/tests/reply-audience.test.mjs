import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GIST_REPLY_AUDIENCE_LABEL, GIST_REPLY_AUDIENCES, isGistReplyAudience, isReplyAudience } from '../lib/reply-audience.ts'

test("a Gist's host may close replies, which an ordinary conversation cannot", () => {
  assert.equal(isGistReplyAudience('off'), true)
  assert.equal(isReplyAudience('off'), false)
  assert.equal(isGistReplyAudience('nobody'), false)
})

test('every way a Gist can limit replies has a label', () => {
  for (const audience of GIST_REPLY_AUDIENCES) assert.ok(GIST_REPLY_AUDIENCE_LABEL[audience].length > 0, audience)
})
