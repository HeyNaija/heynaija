import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GIST_REPLY_AUDIENCE_LABEL, GIST_REPLY_AUDIENCES, gistReplyAudienceNote, isGistReplyAudience, isReplyAudience } from '../lib/reply-audience.ts'

test("a Gist's host may close replies, which an ordinary conversation cannot", () => {
  assert.equal(isGistReplyAudience('off'), true)
  assert.equal(isReplyAudience('off'), false)
  assert.equal(isGistReplyAudience('nobody'), false)
})

test('every way a Gist can limit replies has a label', () => {
  for (const audience of GIST_REPLY_AUDIENCES) assert.ok(GIST_REPLY_AUDIENCE_LABEL[audience].length > 0, audience)
})

test("the note under a Gist's replies is the host's own wording for the host, and neutral for everyone else", () => {
  assert.equal(gistReplyAudienceNote('following', 'ada', true), 'People you follow can reply')
  assert.equal(gistReplyAudienceNote('mentioned', 'ada', true), 'Only people you mention can reply')
  assert.equal(gistReplyAudienceNote('following', 'ada', false), 'People @ada follows can reply')
  assert.equal(gistReplyAudienceNote('mentioned', 'ada', false), 'Only people mentioned can reply')
  assert.equal(gistReplyAudienceNote('off', 'ada', false), 'Replies off')
  assert.equal(gistReplyAudienceNote('everyone', 'ada', false), 'Everyone can reply')
})
