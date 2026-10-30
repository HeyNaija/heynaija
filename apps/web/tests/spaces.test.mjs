import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyView,
  controlsFor,
  dataUseHint,
  joinFailure,
  listenerLabel,
  nextPollDelay,
  POLL_BASE_MS,
  POLL_MAX_MS,
  titleProblem,
} from '../lib/spaces.ts'

const view = (role, extra = {}) => ({
  status: 'live',
  requestsOpen: true,
  locked: false,
  viewer: { role, requestedToSpeak: false },
  ...extra,
})

test('only the stage gets a microphone; a listener may ask while requests are open', () => {
  for (const role of ['host', 'cohost', 'speaker']) assert.equal(controlsFor(view(role)).mic, true, role)
  const listener = controlsFor(view('listener'))
  assert.equal(listener.mic, false)
  assert.equal(listener.request, true)
  assert.equal(controlsFor(view('listener', { requestsOpen: false })).request, false)
  assert.equal(controlsFor(view('speaker')).request, false)
})

test('a listener with an open request can withdraw it and cannot ask twice', () => {
  const waiting = controlsFor(view('listener', { viewer: { role: 'listener', requestedToSpeak: true } }))
  assert.equal(waiting.request, false)
  assert.equal(waiting.cancelRequest, true)
  // Withdrawing stays possible after the host closes requests.
  const closed = controlsFor(view('listener', { requestsOpen: false, viewer: { role: 'listener', requestedToSpeak: true } }))
  assert.equal(closed.cancelRequest, true)
})

test('host and co-host moderate; only the host ends, locks and appoints', () => {
  const host = controlsFor(view('host'))
  assert.deepEqual([host.moderate, host.settings, host.end, host.appointCohost], [true, true, true, true])
  const cohost = controlsFor(view('cohost'))
  assert.deepEqual([cohost.moderate, cohost.settings, cohost.end, cohost.appointCohost], [true, false, false, false])
  const speaker = controlsFor(view('speaker'))
  assert.deepEqual([speaker.moderate, speaker.settings, speaker.end], [false, false, false])
  assert.equal(controlsFor(view('listener')).moderate, false)
})

test('an ended Space has no controls at all', () => {
  const c = controlsFor(view('host', { status: 'ended' }))
  assert.deepEqual(Object.values(c).filter(Boolean), [])
})

test('a poll that changes my role says so once, and asks for a permission reset', () => {
  const up = applyView({ role: 'listener', status: 'live' }, view('speaker'))
  assert.equal(up.role, 'speaker')
  assert.match(up.announcement, /speaker/i)
  assert.equal(up.resync, true)
  const down = applyView({ role: 'speaker', status: 'live' }, view('listener'))
  assert.match(down.announcement, /listener/i)
  assert.equal(down.resync, true)
  const same = applyView({ role: 'listener', status: 'live' }, view('listener'))
  assert.equal(same.announcement, null)
  assert.equal(same.resync, false)
})

test('a poll that finds the Space ended says so', () => {
  const r = applyView({ role: 'listener', status: 'live' }, view('listener', { status: 'ended' }))
  assert.equal(r.ended, true)
  assert.match(r.announcement, /ended/i)
  assert.equal(applyView({ role: 'listener', status: 'ended' }, view('listener', { status: 'ended' })).announcement, null)
})

test('a poll that shows I am no longer in the Space (role null) is not a role change', () => {
  const r = applyView({ role: 'listener', status: 'live' }, view(null))
  assert.equal(r.announcement, null)
  assert.equal(r.resync, false)
})

test('polling every few seconds, never while hidden, backing off on failure up to a ceiling', () => {
  assert.equal(nextPollDelay({ hidden: false, failures: 0 }), POLL_BASE_MS)
  assert.ok(POLL_BASE_MS >= 3000 && POLL_BASE_MS <= 6000)
  assert.equal(nextPollDelay({ hidden: true, failures: 0 }), null)
  assert.equal(nextPollDelay({ hidden: false, failures: 1 }), POLL_BASE_MS * 2)
  assert.equal(nextPollDelay({ hidden: false, failures: 50 }), POLL_MAX_MS)
})

test('join refusals map to the room states, and an unknown one is a retryable failure', () => {
  assert.equal(joinFailure(404, undefined), 'notfound')
  assert.equal(joinFailure(409, 'space_full'), 'full')
  assert.equal(joinFailure(409, 'space_locked'), 'locked')
  assert.equal(joinFailure(409, 'space_ended'), 'ended')
  assert.equal(joinFailure(502, 'livekit_unavailable'), 'retry')
  assert.equal(joinFailure(429, undefined), 'retry')
  assert.equal(joinFailure(0, undefined), 'retry')
})

test('listener counts read in plain English', () => {
  assert.equal(listenerLabel(0), 'No listeners yet')
  assert.equal(listenerLabel(1), '1 listener')
  assert.equal(listenerLabel(1200), '1,200 listeners')
})

test('the data hint appears on mobile data or when the browser asks to save data', () => {
  assert.match(dataUseHint({ type: 'cellular' }), /mobile data/i)
  assert.match(dataUseHint({ saveData: true }), /data/i)
  assert.match(dataUseHint(undefined), /43 MB/)
  assert.match(dataUseHint({ type: 'wifi' }), /43 MB/)
})

test('a title is required and at most 200 characters', () => {
  assert.ok(titleProblem('   '))
  assert.equal(titleProblem(' Jollof debate '), null)
  assert.ok(titleProblem('x'.repeat(201)))
  assert.equal(titleProblem('x'.repeat(200)), null)
})
