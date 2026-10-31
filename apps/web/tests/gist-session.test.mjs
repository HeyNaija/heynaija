import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RECONNECT_ATTEMPTS, GistSession } from '../lib/gist-session.ts'
import { createLatest } from '../lib/gists.ts'

const deferred = () => {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}
const joined = { ok: true, data: { url: 'ws://x', token: 't', role: 'listener', gist: { status: 'live' } } }

/** Fakes for everything the session touches, and a log of what it did. */
function rig({ join, createAudio, holdScreen } = {}) {
  const log = []
  const phases = []
  const audios = []
  let events
  const deps = {
    join: join ?? (async () => joined),
    sync: () => log.push('sync'),
    leave: () => log.push('leave'),
    createAudio:
      createAudio ??
      (async (e) => {
        events = e
        const audio = {
          connects: 0,
          disconnected: 0,
          connect: async () => void audio.connects++,
          disconnect: async () => void audio.disconnected++,
        }
        audios.push(audio)
        return audio
      }),
    rememberGist: (on) => log.push(on ? 'remember' : 'forget'),
    holdScreen:
      holdScreen ??
      (async () => {
        log.push('wake')
        return () => log.push('unwake')
      }),
    sleep: async () => {},
    reloadPage: () => log.push('reload'),
    ui: {
      phase: (p) => phases.push(p),
      problem: () => {},
      joined: () => log.push('joined'),
      announce: () => {},
      playbackBlocked: () => {},
      speaking: () => {},
      micOff: () => {},
      mics: () => {},
    },
  }
  const session = new GistSession(deps)
  session.open()
  return { session, log, phases, audios, lose: (reason) => events.onLost(reason) }
}

const count = (log, what) => log.filter((x) => x === what).length

test('leaving while /join is in flight sends one /leave and never builds a connection', async () => {
  const gate = deferred()
  let created = 0
  const r = rig({ join: () => gate.promise, createAudio: async () => void created++ })
  const joining = r.session.join()
  r.session.dispose()
  gate.resolve(joined)
  await joining
  assert.equal(created, 0)
  assert.equal(count(r.log, 'leave'), 1)
  assert.equal(count(r.log, 'wake'), 0)
  assert.equal(count(r.log, 'remember'), 0)
  assert.ok(!r.phases.includes('live'))
})

test('leaving while the media library loads disconnects what it built and leaves once', async () => {
  const gate = deferred()
  const audio = { disconnected: 0, connects: 0, connect: async () => void audio.connects++, disconnect: async () => void audio.disconnected++ }
  const r = rig({ createAudio: () => gate.promise })
  const joining = r.session.join()
  await new Promise((resolve) => setTimeout(resolve, 0))
  r.session.dispose()
  gate.resolve(audio)
  await joining
  assert.equal(audio.connects, 0)
  assert.equal(audio.disconnected, 1)
  assert.equal(count(r.log, 'leave'), 1)
  assert.equal(count(r.log, 'wake'), 0)
})

test('leaving while the media connection is being made disconnects it and releases the wake lock', async () => {
  const gate = deferred()
  const audio = { disconnected: 0, connect: () => gate.promise, disconnect: async () => void audio.disconnected++ }
  const r = rig({ createAudio: async () => audio })
  const joining = r.session.join()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await r.session.leave()
  gate.resolve()
  await joining
  assert.equal(audio.disconnected, 1)
  assert.equal(count(r.log, 'leave'), 1)
  assert.equal(count(r.log, 'sync'), 0)
  assert.equal(count(r.log, 'wake'), 0)
})

test('a leave during the wake-lock request releases the lock that arrives late', async () => {
  const gate = deferred()
  const r = rig({ holdScreen: () => gate.promise })
  const joining = r.session.join()
  await new Promise((resolve) => setTimeout(resolve, 0))
  r.session.dispose()
  let released = 0
  gate.resolve(() => released++)
  await joining
  assert.equal(released, 1)
  assert.equal(count(r.log, 'leave'), 1)
  assert.ok(!r.phases.includes('live'))
})

test('a normal join goes live: sync once, remembered, wake lock held, no leave', async () => {
  const r = rig()
  await r.session.join()
  assert.equal(r.phases.at(-1), 'live')
  assert.equal(count(r.log, 'sync'), 1)
  assert.equal(count(r.log, 'leave'), 0)
  assert.ok(r.log.includes('wake') && r.log.includes('remember'))
})

test('leave after a normal join disconnects, forgets, unlocks and sends /leave once', async () => {
  const r = rig()
  await r.session.join()
  await r.session.leave()
  await r.session.leave()
  assert.equal(r.audios[0].disconnected, 1)
  assert.equal(count(r.log, 'leave'), 1)
  assert.ok(r.log.includes('unwake'))
  assert.equal(r.log.filter((x) => x === 'forget' || x === 'remember').at(-1), 'forget')
})

test('a duplicate identity stops at "elsewhere": no rejoin, no /leave; the button joins again', async () => {
  let joins = 0
  const r = rig({ join: async () => (joins++, joined) })
  await r.session.join()
  r.lose('duplicate')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(r.phases.at(-1), 'elsewhere')
  assert.equal(joins, 1)
  assert.equal(count(r.log, 'leave'), 0)
  await r.session.join()
  assert.equal(joins, 2)
  assert.equal(r.phases.at(-1), 'live')
})

test('being removed ends in "gone" and never rejoins; a deleted room is "ended"', async () => {
  let joins = 0
  const a = rig({ join: async () => (joins++, joined) })
  await a.session.join()
  a.lose('removed')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(a.phases.at(-1), 'gone')
  assert.equal(joins, 1)
  assert.equal(count(a.log, 'leave'), 0)

  const b = rig()
  await b.session.join()
  b.lose('room_deleted')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(b.phases.at(-1), 'ended')
})

test('a network drop reconnects by asking the API for a new token', async () => {
  let joins = 0
  const r = rig({ join: async () => (joins++, joined) })
  await r.session.join()
  r.lose('network')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(joins, 2)
  assert.equal(r.phases.at(-1), 'live')
})

test('reconnecting gives up after a capped number of attempts', async () => {
  let joins = 0
  let fail = false
  const r = rig({ join: async () => (fail ? (joins++, { ok: false, status: 503 }) : joined) })
  await r.session.join()
  fail = true
  r.lose('network')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(joins, RECONNECT_ATTEMPTS)
  assert.equal(r.phases.at(-1), 'failed')
})

test('when reconnects run out after successful /join calls, the member is sent /leave once and nothing after', async () => {
  let joins = 0
  let connects = 0
  // /join always answers 200 (so the server counts us present) but the media connection keeps failing after the first.
  let captured
  const createAudio = async (events) => {
    captured = events
    return {
      connect: async () => {
        if (++connects > 1) throw new Error('no route')
      },
      disconnect: async () => {},
    }
  }
  const r = rig({ join: async () => (joins++, joined), createAudio })
  await r.session.join()
  captured.onLost('network')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(joins, 1 + RECONNECT_ATTEMPTS)
  assert.equal(r.phases.at(-1), 'failed')
  // Closing the page afterwards must not add a second /leave, and the one already sent must have happened.
  r.session.pageHide()
  r.session.dispose()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(count(r.log, 'leave'), 1)
})

test('after "failed", Try again joins cleanly and goes live', async () => {
  let connects = 0
  const createAudio = async () => ({
    connect: async () => {
      // The first two connection attempts fail: the join and the one reconnect that follows... then it works.
      if (++connects <= 1 + RECONNECT_ATTEMPTS) throw new Error('no route')
    },
    disconnect: async () => {},
  })
  const r = rig({ createAudio })
  await r.session.join()
  assert.equal(r.phases.at(-1), 'failed')
  const before = count(r.log, 'leave')
  // Initial join fails once (retry) -> failed; a retry that now connects goes live.
  connects = 1 + RECONNECT_ATTEMPTS
  await r.session.join()
  assert.equal(r.phases.at(-1), 'live')
  assert.equal(count(r.log, 'leave') >= before, true)
})

test('leaving while a reconnect waits on /join does not reconnect the connection just closed', async () => {
  const gate = deferred()
  let first = true
  const r = rig({ join: () => (first ? ((first = false), Promise.resolve(joined)) : gate.promise) })
  await r.session.join()
  r.lose('network')
  await new Promise((resolve) => setTimeout(resolve, 0))
  await r.session.leave()
  gate.resolve(joined)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(r.audios[0].connects, 1)
  assert.ok(r.audios[0].disconnected >= 1)
  assert.ok(count(r.log, 'leave') >= 1)
})

test('join refusals: 404 reloads for the real not-found page, 409 full shows the full state', async () => {
  const a = rig({ join: async () => ({ ok: false, status: 404 }) })
  await a.session.join()
  assert.ok(a.log.includes('reload'))
  const b = rig({ join: async () => ({ ok: false, status: 409, code: 'gist_full' }) })
  await b.session.join()
  assert.equal(b.phases.at(-1), 'full')
})

test('pagehide sends /leave once, so a closed tab stops counting at once', async () => {
  const r = rig()
  await r.session.join()
  r.session.pageHide()
  r.session.pageHide()
  assert.equal(count(r.log, 'leave'), 1)
})

test('only the latest poll applies, even when responses arrive out of order', () => {
  const latest = createLatest()
  const a = latest.begin()
  const b = latest.begin()
  assert.equal(latest.accept(b), true)
  assert.equal(latest.accept(a), false)
})

test('a poll requested before the member acted cannot undo the action', () => {
  const latest = createLatest()
  const timer = latest.begin()
  latest.noteAction()
  const refresh = latest.begin()
  assert.equal(latest.accept(refresh), true)
  assert.equal(latest.accept(timer), false)
  // And if the stale one lands first, it is still refused.
  const l2 = createLatest()
  const stale = l2.begin()
  l2.noteAction()
  const fresh = l2.begin()
  assert.equal(l2.accept(stale), false)
  assert.equal(l2.accept(fresh), true)
})
