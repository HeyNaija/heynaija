import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GistSession } from '../lib/gist-session.ts'
import { activationAllowed, ACTIVATION_GRACE_MS, callOutcome, incomingPollDelay, mayTakeFocus, ringSecondsLeft, startFailure } from '../lib/calls.ts'

test('the ring countdown never goes below zero or shows a fraction', () => {
  const at = '2026-10-30T10:00:45.000Z'
  assert.equal(ringSecondsLeft(at, Date.parse('2026-10-30T10:00:00.000Z')), 45)
  assert.equal(ringSecondsLeft(at, Date.parse('2026-10-30T10:00:44.100Z')), 1)
  assert.equal(ringSecondsLeft(at, Date.parse('2026-10-30T10:01:00.000Z')), 0)
  assert.equal(ringSecondsLeft('nonsense', 0), 0)
})

test('the incoming-call poll is steady while visible, slow while hidden, and backs off on failures', () => {
  assert.equal(incomingPollDelay({ hidden: false, failures: 0 }), 4000)
  assert.equal(incomingPollDelay({ hidden: true, failures: 0 }), 15_000)
  assert.equal(incomingPollDelay({ hidden: false, failures: 2 }), 16_000)
  assert.equal(incomingPollDelay({ hidden: false, failures: 20 }), 30_000)
})

test('how a finished call is worded for each side', () => {
  assert.equal(callOutcome('declined', 'caller').title, 'Call declined')
  assert.equal(callOutcome('missed', 'caller').title, 'No answer')
  assert.equal(callOutcome('missed', 'callee').title, 'Missed call')
  assert.equal(callOutcome('ended', 'caller').title, 'Call ended')
  assert.equal(callOutcome('active', 'caller'), null)
  assert.equal(callOutcome('ringing', 'callee'), null)
})

test('a refused start says only what the member can act on, never why', () => {
  assert.equal(startFailure(404, undefined), 'You cannot call this person right now.')
  assert.match(startFailure(409, 'busy'), /another call/)
  assert.match(startFailure(409, 'already_in_call'), /already on a call/)
  assert.match(startFailure(429, 'rate_limited'), /Too many calls/)
  assert.match(startFailure(0, undefined), /connection/)
  assert.match(startFailure(502, 'livekit_unavailable'), /not available/)
})

test('a call runs on the Gists session: a reload does not leave, pagehide leaves once, a refused token ends it', async () => {
  const log = []
  const phases = []
  const audio = { connect: async () => log.push('connect'), disconnect: async () => log.push('disconnect') }
  let reply = { ok: true, data: { url: 'wss://x', token: 't', call: {} } }
  const session = new GistSession({
    join: async () => reply,
    sync: () => log.push('sync'),
    leave: () => log.push('leave'),
    createAudio: async () => audio,
    rememberGist: () => undefined,
    holdScreen: async () => () => undefined,
    sleep: async () => undefined,
    reloadPage: () => log.push('gone'),
    ui: {
      phase: (p) => phases.push(p),
      problem: () => undefined,
      joined: () => undefined,
      announce: () => undefined,
      playbackBlocked: () => undefined,
      speaking: () => undefined,
      micOff: () => undefined,
      mics: () => undefined,
    },
  })
  session.open()
  await session.join()
  assert.equal(phases.at(-1), 'live')
  session.pageHide()
  session.pageHide()
  assert.equal(log.filter((x) => x === 'leave').length, 1)

  const second = []
  reply = { ok: false, status: 404 }
  const refused = new GistSession({
    join: async () => reply,
    sync: () => undefined,
    leave: () => second.push('leave'),
    createAudio: async () => audio,
    rememberGist: () => undefined,
    holdScreen: async () => () => undefined,
    sleep: async () => undefined,
    reloadPage: () => second.push('gone'),
    ui: { phase: () => undefined, problem: () => undefined, joined: () => undefined, announce: () => undefined, playbackBlocked: () => undefined, speaking: () => undefined, micOff: () => undefined, mics: () => undefined },
  })
  refused.open()
  await refused.join()
  assert.deepEqual(second, ['gone'])
})

test('a key press cannot answer or decline in the first 700 ms after the alert appears', () => {
  assert.equal(ACTIVATION_GRACE_MS, 700)
  assert.equal(activationAllowed(1000, 1000), false)
  assert.equal(activationAllowed(1000, 1699), false)
  assert.equal(activationAllowed(1000, 1700), true)
  // A clock that went backwards never opens the guard early.
  assert.equal(activationAllowed(5000, 1000), false)
})

test('the alert never takes focus from a field, a select, editable text or an open modal', () => {
  assert.equal(mayTakeFocus({ tagName: 'TEXTAREA' }), false)
  assert.equal(mayTakeFocus({ tagName: 'INPUT' }), false)
  assert.equal(mayTakeFocus({ tagName: 'SELECT' }), false)
  assert.equal(mayTakeFocus({ tagName: 'DIV', isContentEditable: true }), false)
  assert.equal(mayTakeFocus({ tagName: 'BUTTON', inModalDialog: true }), false)
  assert.equal(mayTakeFocus({ tagName: 'BODY' }), true)
  assert.equal(mayTakeFocus({ tagName: 'A' }), true)
  assert.equal(mayTakeFocus(null), true)
})
