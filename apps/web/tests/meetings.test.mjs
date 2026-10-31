import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GistSession } from '../lib/gist-session.ts'
import { callsGate, featureForPath } from '../lib/gists-gate.ts'
import { countdownLabel, invitedPeople, joinedPeople, meetingFailure, meetingOutcome, seatsLeft } from '../lib/meetings.ts'

const person = (handle, extra = {}) => ({ id: handle, handle, displayName: null, state: 'joined', isHost: false, ...extra })
const view = (over = {}) => ({
  id: 'm1',
  status: 'open',
  locked: false,
  capacity: 8,
  role: 'host',
  me: 'joined',
  host: { id: 'ada', handle: 'ada', displayName: null },
  participants: [person('ada', { isHost: true }), person('bayo'), person('chi', { state: 'invited' })],
  endedAt: null,
  ...over,
})

test('/meetings/* is gated by the calls feature, /calls/* too, everything else by Gists', () => {
  assert.equal(featureForPath('/meetings/abc'), 'calls')
  assert.equal(featureForPath('/meetings/new'), 'calls')
  assert.equal(featureForPath('/calls/abc'), 'calls')
  assert.equal(featureForPath('/gists/abc'), 'gists')
})

test('a visitor without features.calls gets the deny verdict for a meetings path (the fail-closed gate)', async () => {
  const me = (status, body) => async () => ({ status, json: async () => body })
  assert.equal(await callsGate('good', me(200, { features: { calls: true } })), 'allow')
  assert.equal(await callsGate('good', me(200, { features: { calls: false, gists: true } })), 'deny')
  assert.equal(await callsGate(undefined, me(200, { features: { calls: true } })), 'deny')
  assert.equal(await callsGate('good', async () => { throw new Error('down') }), 'deny')
})

test('the invitation countdown reads in seconds, then minutes, and never goes below zero', () => {
  assert.equal(countdownLabel(45), '45s')
  assert.equal(countdownLabel(60), '1m')
  assert.equal(countdownLabel(61), '2m')
  assert.equal(countdownLabel(300), '5m')
  assert.equal(countdownLabel(-3), '0s')
})

test('who is in the room, who is only invited, and how many seats are left', () => {
  const v = view()
  assert.deepEqual(joinedPeople(v).map((p) => p.handle), ['ada', 'bayo'])
  assert.deepEqual(invitedPeople(v).map((p) => p.handle), ['chi'])
  // Joined and invited both hold a seat.
  assert.equal(seatsLeft(v), 5)
  assert.equal(seatsLeft(view({ participants: [] })), 8)
  assert.equal(seatsLeft(view({ participants: Array.from({ length: 9 }, (_, i) => person(`p${i}`)) })), 0)
})

test('a meeting that is over is worded without saying who or why', () => {
  assert.equal(meetingOutcome(view()), null)
  assert.equal(meetingOutcome(view({ status: 'ended' })).title, 'Meeting ended')
  assert.match(meetingOutcome(view({ status: 'ended' })).detail, /not recorded/i)
})

test('a refused start or invitation says only what the member can act on, never why', () => {
  assert.equal(meetingFailure(404, undefined), 'You cannot do that right now.')
  assert.match(meetingFailure(409, 'already_in_meeting'), /already in a meeting/)
  assert.match(meetingFailure(409, 'in_call'), /on a call/)
  assert.match(meetingFailure(409, 'full'), /full/)
  assert.match(meetingFailure(409, 'locked'), /locked/)
  assert.match(meetingFailure(429, 'rate_limited'), /Too many/)
  assert.match(meetingFailure(0, undefined), /connection/)
  assert.match(meetingFailure(502, 'livekit_unavailable'), /not available/)
})

test('a meeting runs on the Gists session with its own words: a refused token ends it for us', async () => {
  const log = []
  const said = []
  const audio = {
    connect: async () => void log.push('connect'),
    disconnect: async () => void log.push('disconnect'),
    setMic: async () => undefined,
    applyMic: async () => undefined,
    startAudio: async () => undefined,
    watchLevel: () => () => undefined,
  }
  let token = { ok: true, data: { url: 'wss://x', token: 't', meeting: view() } }
  const session = new GistSession({
    join: async () => token,
    sync: () => undefined,
    leave: () => void log.push('leave'),
    createAudio: async () => audio,
    rememberGist: () => undefined,
    holdScreen: async () => () => undefined,
    sleep: async () => undefined,
    reloadPage: () => void log.push('reload'),
    noun: 'meeting',
    ui: {
      phase: (p) => void log.push(`phase:${p}`),
      problem: () => undefined,
      joined: () => undefined,
      announce: (t) => void said.push(t),
      playbackBlocked: () => undefined,
      speaking: () => undefined,
      micOff: () => undefined,
      mics: () => undefined,
    },
  })
  session.open()
  await session.join()
  assert.ok(log.includes('phase:live'))
  assert.match(said.join(' '), /You are in the meeting/)
  assert.doesNotMatch(said.join(' '), /Gist/)
})

test('StrictMode: mount, dispose, mount with the real session, then the first join resolves => no /leave', async () => {
  const log = []
  const resolvers = []
  const audio = { connect: async () => undefined, disconnect: async () => undefined, setMic: async () => undefined, applyMic: async () => undefined, startAudio: async () => undefined, watchLevel: () => () => undefined }
  const session = new GistSession({
    join: () => new Promise((resolve) => { resolvers.push(resolve) }),
    sync: () => undefined,
    leave: () => void log.push('leave'),
    createAudio: async () => audio,
    rememberGist: () => undefined,
    holdScreen: async () => () => undefined,
    sleep: async () => undefined,
    reloadPage: () => undefined,
    noun: 'meeting',
    ui: { phase: (p) => void log.push(`phase:${p}`), problem: () => undefined, joined: () => undefined, announce: () => undefined, playbackBlocked: () => undefined, speaking: () => undefined, micOff: () => undefined, mics: () => undefined },
  })
  // The component's mount effect: open() then join(); its cleanup: dispose(); the second mount: open() again, join().
  session.open()
  const first = session.join()
  session.dispose()
  session.open()
  const second = session.join()
  // The first request answers first, as a real one would; both answers are good.
  for (const resolve of resolvers) resolve({ ok: true, data: { url: 'wss://x', token: 't', meeting: view() } })
  await Promise.all([first, second])
  assert.ok(!log.includes('leave'), log.join(','))
  assert.ok(log.includes('phase:live'), log.join(','))
})
