import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyView,
  controlsFor,
  dataUseHint,
  gistBarStatus,
  gistDock,
  gistsButtonLabel,
  isInGist,
  joinFailure,
  listenerLabel,
  liveMeta,
  lostNotice,
  nextPollDelay,
  noneLiveText,
  otherLive,
  POLL_BASE_MS,
  POLL_MAX_MS,
  titleProblem,
} from '../lib/gists.ts'

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

test('a member who may only listen is offered neither the microphone nor a request, and told nothing about requests', () => {
  for (const requestsOpen of [true, false]) {
    const listener = controlsFor(view('listener', { requestsOpen, mayTakeStage: false }))
    assert.deepEqual([listener.mic, listener.request, listener.requestsClosed], [false, false, false])
  }
  assert.equal(controlsFor(view('speaker', { mayTakeStage: false })).mic, false)
  // Anyone else is told when the host closes requests.
  assert.equal(controlsFor(view('listener', { requestsOpen: false })).requestsClosed, true)
  assert.equal(controlsFor(view('listener')).requestsClosed, false)
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

test('an ended Gist has no controls at all', () => {
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

test('a poll that finds the Gist ended says so', () => {
  const r = applyView({ role: 'listener', status: 'live' }, view('listener', { status: 'ended' }))
  assert.equal(r.ended, true)
  assert.match(r.announcement, /ended/i)
  assert.equal(applyView({ role: 'listener', status: 'ended' }, view('listener', { status: 'ended' })).announcement, null)
})

test('a poll that shows I am no longer in the Gist (role null) is not a role change', () => {
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
  assert.equal(joinFailure(409, 'gist_full'), 'full')
  assert.equal(joinFailure(409, 'gist_locked'), 'locked')
  assert.equal(joinFailure(409, 'gist_ended'), 'ended')
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

test('a title is required and at most 120 characters, the most the API takes', () => {
  assert.ok(titleProblem('   '))
  assert.equal(titleProblem(' Jollof debate '), null)
  assert.ok(titleProblem('x'.repeat(121)))
  assert.equal(titleProblem('x'.repeat(120)), null)
})

test('a Live now row says who hosts it, in which community, and how many listen', () => {
  const host = { id: 'a', handle: 'ada', displayName: 'Ada Obi' }
  assert.equal(liveMeta({ host, community: null, listenerCount: 0 }), 'Hosted by Ada Obi · No listeners yet')
  assert.equal(
    liveMeta({ host: { ...host, displayName: null }, community: { id: 'c', slug: 'lagos', name: 'Lagos' }, listenerCount: 3 }),
    'Hosted by @ada · in Lagos · 3 listeners',
  )
})

test('the Gists button says whether the member is in one, and how many others are live', () => {
  assert.equal(gistsButtonLabel(false, 0), 'Gists')
  assert.equal(gistsButtonLabel(false, 2), 'Gists. 2 live now.')
  assert.equal(gistsButtonLabel(true, 0), 'Gists. You are in one.')
  assert.equal(gistsButtonLabel(true, 1), 'Gists. You are in one, and 1 more is live.')
  assert.equal(gistsButtonLabel(true, 3), 'Gists. You are in one, and 3 more are live.')
  assert.equal(gistsButtonLabel(false, 1200), 'Gists. 1,200 live now.')
})

test('the red dot counts the live Gists other than the one the member is in', () => {
  const live = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(otherLive(live, null), live)
  assert.deepEqual(otherLive(live, 'a'), [{ id: 'b' }])
  assert.deepEqual(otherLive([{ id: 'a' }], 'a'), [])
  assert.equal(noneLiveText(false), 'No Gists are live right now.')
  assert.equal(noneLiveText(true), 'No other Gists are live right now.')
})

test('a member is in a Gist while connecting, live or reconnecting, and in nothing else', () => {
  for (const phase of ['connecting', 'live', 'reconnecting']) assert.equal(isInGist(phase), true, phase)
  for (const phase of ['prejoin', 'ended', 'full', 'locked', 'failed', 'elsewhere', 'gone', null, undefined]) assert.equal(isInGist(phase), false, String(phase))
})

test('the bar says what the connection, then the pause, then the microphone is doing', () => {
  const base = { phase: 'live', hearing: true, mayUseMic: false, micOn: false, micBusy: false }
  assert.equal(gistBarStatus(base), 'Listening')
  assert.equal(gistBarStatus({ ...base, phase: 'connecting' }), 'Connecting…')
  assert.equal(gistBarStatus({ ...base, phase: 'reconnecting', hearing: false }), 'Reconnecting…')
  assert.equal(gistBarStatus({ ...base, hearing: false, mayUseMic: true, micOn: true }), 'Paused. You are still in the Gist.')
  assert.equal(gistBarStatus({ ...base, mayUseMic: true, micOn: true }), 'Your microphone is on')
  assert.equal(gistBarStatus({ ...base, mayUseMic: true, micBusy: true }), 'Starting your microphone…')
  assert.equal(gistBarStatus({ ...base, mayUseMic: true }), 'Your microphone is off')
  // A listener's microphone is never mentioned, even if a stale flag says it is on.
  assert.equal(gistBarStatus({ ...base, micOn: true }), 'Listening')
})

test('the bar shows over every page but the Gist\'s own, while the member is in it', () => {
  const at = (pathname, phase = 'live', notice = null) => gistDock({ roomId: 'g1', phase, pathname, notice })
  assert.equal(at('/'), 'in')
  assert.equal(at('/c/lagos'), 'in')
  assert.equal(at('/gists/g1'), 'none')
  assert.equal(at('/gists/g2'), 'in')
  assert.equal(at('/', 'connecting'), 'in')
  assert.equal(at('/', 'reconnecting'), 'in')
  assert.equal(at('/', 'prejoin'), 'none')
  assert.equal(at('/', 'ended'), 'none')
  assert.equal(at('/', 'ended', 'The Gist you were in has ended.'), 'notice')
  assert.equal(at('/gists/g1', 'ended', 'The Gist you were in has ended.'), 'none')
  assert.equal(gistDock({ roomId: null, phase: null, pathname: '/', notice: null }), 'none')
})

test('losing a Gist away from its page is explained; leaving it or never getting in is not', () => {
  assert.equal(lostNotice('live', 'ended'), 'The Gist you were in has ended.')
  assert.equal(lostNotice('reconnecting', 'failed'), 'The connection to the Gist was lost.')
  assert.equal(lostNotice('live', 'elsewhere'), 'The Gist is playing in another tab or on another device.')
  assert.equal(lostNotice('live', 'gone'), 'You are no longer in the Gist.')
  assert.equal(lostNotice('reconnecting', 'full'), 'Could not get back into the Gist.')
  assert.equal(lostNotice('live', 'prejoin'), 'You left the Gist when you left HeyNaija.')
  assert.equal(lostNotice('live', 'reconnecting'), null)
  assert.equal(lostNotice('connecting', 'live'), null)
  assert.equal(lostNotice('prejoin', 'full'), null)
  assert.equal(lostNotice(null, 'ended'), null)
})
