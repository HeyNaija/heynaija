import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, calls, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { FakeRoomService, type FakeToken } from '../gists/fake-room-service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { CallError, CallsService, type CallsConfig } from './calls.service.js'

const people = ['ada', 'bayo', 'chi', 'outsider'] as const
type P = (typeof people)[number]
const id = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<P, string>
const as = (p: P) => ({ id: id[p], handle: p })
const config: CallsConfig = { callsMembers: ['ada', 'bayo', 'chi'], livekitUrl: 'wss://livekit.test', enabled: true }

let rooms: FakeRoomService
let service: CallsService

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (err: unknown) {
    assert.ok(err instanceof CallError, String(err))
    return err.code
  }
  return 'ok'
}
const row = async (callId: string) => (await db.select().from(calls).where(eq(calls.id, callId)))[0]!
const statusOf = async (callId: string) => (await row(callId)).status
const token = (jwt: string) => JSON.parse(jwt) as FakeToken
const ring = async (from: P, to: P) => (await service.create(as(from), id[to])).id
const answered = async (from: P, to: P) => {
  const callId = await ring(from, to)
  await service.accept(as(to), callId)
  return callId
}
const event = (kind: 'participant_joined' | 'participant_left' | 'room_finished', room: string, who?: P, sid?: string) =>
  service.handleEvent({ id: randomUUID(), kind, room, identity: who ? id[who] : '', sid: sid ?? null, at: new Date() } as never)
const old = (callId: string) =>
  db.update(calls).set({ answeredAt: new Date(Date.now() - 5 * 60_000) }).where(eq(calls.id, callId))

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values(people.map((p) => ({ id: id[p], handle: p, allowCalls: true })))
  rooms = new FakeRoomService()
  service = new CallsService(db, rooms, config)
})
after(() => pool.end())

test('calling makes a ringing call, its room and a 45 second ring', async () => {
  const view = await service.create(as('ada'), id.bayo)
  assert.equal(view.status, 'ringing')
  assert.equal(view.role, 'caller')
  assert.equal(view.other.handle, 'bayo')
  assert.deepEqual(rooms.rooms.get(view.id), { maxParticipants: 2, emptyTimeoutS: 60, departureTimeoutS: 20 })
  const secs = ((await row(view.id)).ringExpiresAt.getTime() - Date.now()) / 1000
  assert.ok(secs > 40 && secs <= 45, String(secs))
  const incoming = await service.incoming(as('bayo'))
  assert.equal(incoming?.id, view.id)
  assert.equal(incoming?.other.handle, 'ada')
  assert.equal(await service.incoming(as('ada')), null)
})

test('an ineligible callee, a stranger, yourself and a block (either way) all look like nobody there', async () => {
  assert.equal(await codeOf(service.create(as('ada'), id.outsider)), 'not_found')
  assert.equal(await codeOf(service.create(as('outsider'), id.ada)), 'not_found')
  assert.equal(await codeOf(service.create(as('ada'), id.ada)), 'not_found')
  assert.equal(await codeOf(service.create(as('ada'), 'nope')), 'not_found')
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.ada })
  assert.equal(await codeOf(service.create(as('ada'), id.bayo)), 'not_found')
  assert.equal(await codeOf(service.create(as('bayo'), id.ada)), 'not_found')
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.chi))
  assert.equal(await codeOf(service.create(as('ada'), id.chi)), 'not_found')
  assert.equal((await db.select().from(calls)).length, 0)
})

test('one open call per member', async () => {
  await ring('ada', 'bayo')
  assert.equal(await codeOf(service.create(as('ada'), id.chi)), 'already_in_call')
  assert.equal(await codeOf(service.create(as('bayo'), id.chi)), 'already_in_call')
  assert.equal(await codeOf(service.create(as('chi'), id.bayo)), 'busy')
  assert.equal(await codeOf(service.create(as('chi'), id.ada)), 'busy')
})

test('a failed room leaves no ringing call behind', async () => {
  rooms.failNext = 'createRoom'
  assert.equal(await codeOf(service.create(as('ada'), id.bayo)), 'livekit_unavailable')
  assert.equal((await db.select().from(calls))[0]?.status, 'ended')
  await ring('ada', 'bayo')
})

test('only the callee accepts, and then the call is active', async () => {
  const callId = await ring('ada', 'bayo')
  assert.equal(await codeOf(service.accept(as('ada'), callId)), 'not_found')
  assert.equal(await codeOf(service.accept(as('chi'), callId)), 'not_found')
  const view = await service.accept(as('bayo'), callId)
  assert.equal(view.status, 'active')
  assert.equal(await codeOf(service.accept(as('bayo'), callId)), 'not_found')
})

test('tokens: two parties only, both may publish audio, the callee only once answered', async () => {
  const callId = await ring('ada', 'bayo')
  const t = await service.token(as('ada'), callId)
  assert.equal(t.url, 'wss://livekit.test')
  const granted = token(t.token)
  assert.deepEqual(
    { room: granted.room, identity: granted.identity, canPublish: granted.canPublish, data: granted.canPublishData },
    { room: callId, identity: id.ada, canPublish: true, data: false },
  )
  assert.equal(await codeOf(service.token(as('bayo'), callId)), 'not_found')
  assert.equal(await codeOf(service.token(as('chi'), callId)), 'not_found')
  await service.accept(as('bayo'), callId)
  assert.equal(token((await service.token(as('bayo'), callId)).token).canPublish, true)
  assert.equal(await codeOf(service.token(as('chi'), callId)), 'not_found')
})

test('no token when a block has come between them, and the call ends', async () => {
  const callId = await answered('ada', 'bayo')
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.ada })
  assert.equal(await codeOf(service.token(as('ada'), callId)), 'not_found')
  assert.equal(await statusOf(callId), 'ended')
  assert.ok(rooms.deleted.includes(callId))
  assert.equal(await codeOf(service.token(as('bayo'), callId)), 'not_found')
})

test('decline, cancel and end', async () => {
  let callId = await ring('ada', 'bayo')
  assert.equal(await codeOf(service.decline(as('ada'), callId)), 'not_found')
  await service.decline(as('bayo'), callId)
  assert.equal(await statusOf(callId), 'declined')
  assert.ok(rooms.deleted.includes(callId))

  callId = await ring('ada', 'bayo')
  assert.equal(await codeOf(service.cancel(as('bayo'), callId)), 'not_found')
  await service.cancel(as('ada'), callId)
  assert.equal(await statusOf(callId), 'missed')
  assert.equal(await service.incoming(as('bayo')), null)

  callId = await answered('ada', 'bayo')
  assert.equal(await codeOf(service.end(as('chi'), callId)), 'not_found')
  await service.end(as('bayo'), callId)
  assert.equal(await statusOf(callId), 'ended')
  await service.end(as('ada'), callId) // already over: not an error
  await ring('bayo', 'ada') // both are free again
})

test('a call nobody answers in 45 seconds is missed, whoever looks first', async () => {
  const callId = await ring('ada', 'bayo')
  await db.update(calls).set({ ringExpiresAt: new Date(Date.now() - 1000) }).where(eq(calls.id, callId))
  assert.equal(await service.incoming(as('bayo')), null)
  assert.equal(await statusOf(callId), 'missed')
  assert.equal(await codeOf(service.accept(as('bayo'), callId)), 'not_found')
  await ring('ada', 'bayo')
})

test('webhook: leaving ends an active call; the leave of a replaced connection does not', async () => {
  const callId = await answered('ada', 'bayo')
  await event('participant_joined', callId, 'ada', 'sid-1')
  await event('participant_joined', callId, 'ada', 'sid-2')
  await event('participant_left', callId, 'ada', 'sid-1')
  assert.equal(await statusOf(callId), 'active')
  await event('participant_left', callId, 'ada', 'sid-2')
  assert.equal(await statusOf(callId), 'ended')
  assert.ok(rooms.deleted.includes(callId))
  await event('participant_left', callId, 'ada', 'sid-2') // a repeat is harmless
})

test('webhook: someone who is not a party, or the callee before answering, is removed from the room', async () => {
  const callId = await ring('ada', 'bayo')
  rooms.connect(callId, id.chi)
  await event('participant_joined', callId, 'chi', 'x')
  assert.ok(rooms.removed.includes(`${callId}/${id.chi}`))
  rooms.connect(callId, id.bayo)
  await event('participant_joined', callId, 'bayo', 'y')
  assert.ok(rooms.removed.includes(`${callId}/${id.bayo}`))
  await event('participant_joined', callId, 'ada', 'z')
  assert.ok(!rooms.removed.includes(`${callId}/${id.ada}`))
  assert.equal((await row(callId)).callerSid, 'z')
})

test('webhook: a party who lost eligibility is removed and the call ends', async () => {
  const callId = await answered('ada', 'bayo')
  await db.insert(blocks).values({ blockerId: id.ada, blockedId: id.bayo })
  rooms.connect(callId, id.bayo)
  await event('participant_joined', callId, 'bayo', 'w')
  assert.ok(rooms.removed.includes(`${callId}/${id.bayo}`))
  assert.equal(await statusOf(callId), 'ended')
})

test('webhook: room_finished ends an active call and marks a ringing one missed; unknown rooms are ignored', async () => {
  const a = await answered('ada', 'bayo')
  await event('room_finished', a)
  assert.equal(await statusOf(a), 'ended')
  const b = await ring('ada', 'bayo')
  await event('room_finished', b)
  assert.equal(await statusOf(b), 'missed')
  await event('room_finished', randomUUID())
  await event('room_finished', 'not-a-uuid')
})

test('reconcile: expires stale rings, ends calls with someone missing, ends calls that lost eligibility', async () => {
  const ringing = await ring('ada', 'bayo')
  await db.update(calls).set({ ringExpiresAt: new Date(Date.now() - 1000) }).where(eq(calls.id, ringing))
  await service.reconcile()
  assert.equal(await statusOf(ringing), 'missed')

  // Active, answered long ago, and the room is empty: a lost room_finished.
  const stuck = await answered('ada', 'bayo')
  await old(stuck)
  await service.reconcile()
  assert.equal(await statusOf(stuck), 'ended')

  // Both present: left alone. One alone: ended.
  const live = await answered('ada', 'bayo')
  await old(live)
  rooms.connect(live, id.ada)
  rooms.connect(live, id.bayo)
  await service.reconcile()
  assert.equal(await statusOf(live), 'active')
  rooms.connected.delete(`${live}/${id.bayo}`)
  await service.reconcile()
  assert.equal(await statusOf(live), 'ended')

  // Just answered: given time to connect. A lapse still ends it at once.
  const fresh = await answered('ada', 'bayo')
  await service.reconcile()
  assert.equal(await statusOf(fresh), 'active')
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.bayo))
  await service.reconcile()
  assert.equal(await statusOf(fresh), 'ended')
})

test('reconcile survives LiveKit being down and leaves the call for the next pass', async () => {
  const callId = await answered('ada', 'bayo')
  await old(callId)
  rooms.failNext = 'participants'
  await service.reconcile()
  assert.equal(await statusOf(callId), 'active')
})

test('the Allow calls setting is for allow-listed members only', async () => {
  assert.deepEqual(await service.settings(as('ada')), { allowCalls: true })
  assert.deepEqual(await service.setAllowCalls(as('ada'), false), { allowCalls: false })
  assert.equal(await codeOf(service.create(as('bayo'), id.ada)), 'not_found')
  assert.equal(await codeOf(service.setAllowCalls(as('outsider'), true)), 'not_found')
  assert.equal(await codeOf(service.settings(as('outsider'))), 'not_found')
})

test('eligibility answers yes only for a callable member, and says nothing more', async () => {
  assert.equal(await service.canCallMember(as('ada'), id.bayo), true)
  assert.equal(await service.canCallMember(as('ada'), id.outsider), false)
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.ada })
  assert.equal(await service.canCallMember(as('ada'), id.bayo), false)
  assert.equal(await service.canCallMember(as('ada'), 'junk'), false)
})

test('incoming is the same not-found as a missing route for anyone who cannot use calls at all', async () => {
  assert.equal(await codeOf(service.incoming(as('outsider'))), 'not_found')
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.chi))
  assert.equal(await codeOf(service.incoming(as('chi'))), 'not_found')
  await db.update(members).set({ active: false, status: 'suspended' }).where(eq(members.id, id.bayo))
  assert.equal(await codeOf(service.incoming(as('bayo'))), 'not_found')
  assert.equal(await service.incoming(as('ada')), null)
})

test('flag off: calls in progress are ended and their rooms deleted, and nothing else runs', async () => {
  const off = new CallsService(db, rooms, { ...config, enabled: false })
  const active = await answered('ada', 'bayo')
  rooms.calls.length = 0
  assert.equal(await off.shutdownLive(), 1)
  assert.equal(await statusOf(active), 'ended')
  assert.deepEqual(rooms.deleted, [active])

  const ringing = await ring('ada', 'chi')
  assert.equal(await off.tick(), 1)
  assert.equal(await statusOf(ringing), 'missed')
  assert.ok(rooms.deleted.includes(ringing))
})

test('flag off and nothing live: no work and no LiveKit call', async () => {
  const off = new CallsService(db, rooms, { ...config, enabled: false })
  rooms.calls.length = 0
  assert.equal(await off.tick(), 0)
  assert.deepEqual(rooms.calls, [])
})

test('flag on: the tick reconciles and never tears down live calls', async () => {
  const live = await answered('ada', 'bayo')
  assert.equal(await service.tick(), 0)
  assert.equal(await statusOf(live), 'active')
})
