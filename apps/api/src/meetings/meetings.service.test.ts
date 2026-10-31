import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, calls, meetingParticipants, meetings, members } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { CallsService, type CallsConfig } from '../calls/calls.service.js'
import { FakeRoomService, type FakeToken } from '../gists/fake-room-service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { INVITE_TTL_MS, MAX_PARTICIPANTS, MeetingError, MeetingsService } from './meetings.service.js'

const people = ['ada', 'bayo', 'chi', 'dayo', 'ezi', 'funmi', 'gozie', 'hadiza', 'ife', 'outsider'] as const
type P = (typeof people)[number]
const id = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<P, string>
const as = (p: P) => ({ id: id[p], handle: p })
const config: CallsConfig = { callsMembers: people.filter((p) => p !== 'outsider'), livekitUrl: 'wss://livekit.test', enabled: true }

let rooms: FakeRoomService
let service: MeetingsService

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (err: unknown) {
    assert.ok(err instanceof MeetingError, String(err))
    return err.code
  }
  return 'ok'
}
const meetingRow = async (meetingId: string) => (await db.select().from(meetings).where(eq(meetings.id, meetingId)))[0]!
const part = async (meetingId: string, p: P) =>
  (await db.select().from(meetingParticipants).where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.memberId, id[p]))))[0]
const stateOf = async (meetingId: string, p: P) => (await part(meetingId, p))?.status
const token = (jwt: string) => JSON.parse(jwt) as FakeToken
/** A meeting hosted by `host`, with everyone in `guests` invited and (unless `join` is false) joined. */
const meet = async (host: P, guests: P[], join = true) => {
  const view = await service.create(as(host), guests.map((g) => id[g]))
  if (join) for (const g of guests) await service.join(as(g), view.id)
  return view.id
}
const event = (kind: 'participant_joined' | 'participant_left' | 'room_finished', room: string, who?: P, sid?: string) =>
  service.handleEvent({ id: randomUUID(), kind, room, identity: who ? id[who] : '', sid: sid ?? null, at: new Date() } as never)
const aged = (meetingId: string) =>
  Promise.all([
    db.update(meetings).set({ createdAt: new Date(Date.now() - 5 * 60_000) }).where(eq(meetings.id, meetingId)),
    db.update(meetingParticipants).set({ joinedAt: new Date(Date.now() - 5 * 60_000) }).where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.status, 'joined'))),
  ])

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values(people.map((p) => ({ id: id[p], handle: p, allowCalls: true })))
  rooms = new FakeRoomService()
  service = new MeetingsService(db, rooms, config)
})
after(() => pool.end())

test('creating a meeting makes the room for at most 8, puts the host in it and invites the others', async () => {
  const view = await service.create(as('ada'), [id.bayo, id.chi])
  assert.equal(view.role, 'host')
  assert.equal(view.locked, false)
  assert.equal(view.host.handle, 'ada')
  assert.equal(MAX_PARTICIPANTS, 8)
  assert.deepEqual(rooms.rooms.get(view.id), { maxParticipants: 8, emptyTimeoutS: 60, departureTimeoutS: 20 })
  assert.equal(await stateOf(view.id, 'ada'), 'joined')
  assert.equal(await stateOf(view.id, 'bayo'), 'invited')
  assert.deepEqual(view.participants.map((p) => [p.handle, p.state]).sort(), [['ada', 'joined'], ['bayo', 'invited'], ['chi', 'invited']])
  const incoming = await service.incoming(as('bayo'))
  assert.equal(incoming?.id, view.id)
  assert.equal(incoming?.host.handle, 'ada')
  assert.equal(await service.incoming(as('ada')), null)
})

test('an ineligible invitee, a stranger, yourself, a block (either way) or too many all look like nobody there, and nothing is made', async () => {
  assert.equal(await codeOf(service.create(as('ada'), [id.outsider])), 'not_found')
  assert.equal(await codeOf(service.create(as('outsider'), [id.ada])), 'not_found')
  assert.equal(await codeOf(service.create(as('ada'), [id.ada])), 'not_found')
  assert.equal(await codeOf(service.create(as('ada'), ['nope'])), 'not_found')
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.ada })
  assert.equal(await codeOf(service.create(as('ada'), [id.bayo, id.chi])), 'not_found')
  assert.equal(await codeOf(service.create(as('bayo'), [id.ada])), 'not_found')
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.chi))
  assert.equal(await codeOf(service.create(as('ada'), [id.chi])), 'not_found')
  const tooMany = (['dayo', 'ezi', 'funmi', 'gozie', 'hadiza', 'ife'] as P[]).map((p) => id[p]).concat(id.bayo, id.ada)
  assert.equal(await codeOf(service.create(as('ezi'), tooMany)), 'not_found')
  assert.equal((await db.select().from(meetings)).length, 0)
})

test('two invitees who blocked each other cannot be in the same invite list', async () => {
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.chi })
  assert.equal(await codeOf(service.create(as('ada'), [id.bayo, id.chi])), 'not_found')
  assert.equal(await codeOf(service.create(as('ada'), [id.chi, id.bayo])), 'not_found')
  assert.equal((await db.select().from(meetings)).length, 0)
})

test('a meeting can have no invitees yet, and duplicate invitees count once', async () => {
  const alone = await service.create(as('ada'), [])
  assert.equal(alone.participants.length, 1)
  const dup = await service.create(as('bayo'), [id.chi, id.chi])
  assert.equal(dup.participants.length, 2)
})

test('one open meeting per member: hosting, being in one, or being on a call', async () => {
  const first = await meet('ada', ['bayo'])
  assert.equal(await codeOf(service.create(as('ada'), [id.chi])), 'already_in_meeting')
  assert.equal(await codeOf(service.create(as('bayo'), [id.chi])), 'already_in_meeting')
  // Invited but not yet in: free to host their own.
  const other = await service.create(as('chi'), [])
  assert.ok(other.id !== first)
  await db.insert(calls).values({ callerId: id.dayo, calleeId: id.ezi, ringExpiresAt: new Date(Date.now() + 40_000) })
  assert.equal(await codeOf(service.create(as('dayo'), [])), 'in_call')
  assert.equal(await codeOf(service.create(as('ezi'), [])), 'in_call')
})

test('a failed room leaves no open meeting behind', async () => {
  rooms.failNext = 'createRoom'
  assert.equal(await codeOf(service.create(as('ada'), [id.bayo])), 'livekit_unavailable')
  assert.equal((await db.select().from(meetings))[0]?.status, 'ended')
  assert.equal(await stateOf((await db.select().from(meetings))[0]!.id, 'ada'), 'left')
  await service.create(as('ada'), [id.bayo])
})

test('only an invited member joins, and then sees who is in', async () => {
  const meetingId = await meet('ada', ['bayo'], false)
  assert.equal(await codeOf(service.join(as('chi'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.join(as('outsider'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.join(as('bayo'), 'nope')), 'not_found')
  const view = await service.join(as('bayo'), meetingId)
  assert.equal(view.me, 'joined')
  assert.equal(view.role, 'participant')
  assert.deepEqual(view.participants.map((p) => p.handle).sort(), ['ada', 'bayo'])
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'ok')
})

test('an invitation that has not been answered in time is gone', async () => {
  const meetingId = await meet('ada', ['bayo'], false)
  await db.update(meetingParticipants).set({ invitedAt: new Date(Date.now() - INVITE_TTL_MS - 1000) }).where(eq(meetingParticipants.meetingId, meetingId))
  assert.equal(await service.incoming(as('bayo')), null)
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'not_found')
})

test('an invitee who declines is out; the host can invite them again', async () => {
  const meetingId = await meet('ada', ['bayo'], false)
  assert.equal(await codeOf(service.decline(as('chi'), meetingId)), 'not_found')
  await service.decline(as('bayo'), meetingId)
  assert.equal(await stateOf(meetingId, 'bayo'), 'declined')
  assert.equal(await service.incoming(as('bayo')), null)
  await service.invite(as('ada'), meetingId, id.bayo)
  assert.equal((await service.incoming(as('bayo')))?.id, meetingId)
})

test('a join that would put a blocker and the blocked in one room is refused, either way round, without saying why', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'], false)
  await service.join(as('bayo'), meetingId)
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.chi })
  assert.equal(await codeOf(service.join(as('chi'), meetingId)), 'not_found')
  assert.equal(await stateOf(meetingId, 'chi'), 'invited')
  // The other direction, and a block against the host.
  const second = await meet('dayo', ['ezi', 'funmi'], false)
  await service.join(as('ezi'), second)
  await db.insert(blocks).values({ blockerId: id.funmi, blockedId: id.ezi })
  assert.equal(await codeOf(service.join(as('funmi'), second)), 'not_found')
  const third = await meet('gozie', ['hadiza'], false)
  await db.insert(blocks).values({ blockerId: id.hadiza, blockedId: id.gozie })
  assert.equal(await codeOf(service.join(as('hadiza'), third)), 'not_found')
})

test('an invitee who stops being eligible cannot join', async () => {
  const meetingId = await meet('ada', ['bayo'], false)
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.bayo))
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'not_found')
  assert.equal(await service.incoming(as('chi')).then(() => 'ok', () => 'x'), 'ok')
})

test('inviting: host only, eligible only, nobody in a block with someone already there, never past 8', async () => {
  const meetingId = await meet('ada', ['bayo'])
  assert.equal(await codeOf(service.invite(as('bayo'), meetingId, id.chi)), 'not_found')
  assert.equal(await codeOf(service.invite(as('ada'), meetingId, id.outsider)), 'not_found')
  assert.equal(await codeOf(service.invite(as('ada'), meetingId, id.ada)), 'not_found')
  await db.insert(blocks).values({ blockerId: id.chi, blockedId: id.bayo })
  assert.equal(await codeOf(service.invite(as('ada'), meetingId, id.chi)), 'not_found')
  await service.invite(as('ada'), meetingId, id.dayo)
  assert.equal(await stateOf(meetingId, 'dayo'), 'invited')
  for (const p of ['ezi', 'funmi', 'gozie', 'hadiza'] as P[]) await service.invite(as('ada'), meetingId, id[p])
  // ada, bayo, dayo, ezi, funmi, gozie, hadiza = 7 live; one more fits, the next does not.
  await service.invite(as('ada'), meetingId, id.ife)
  await db.update(members).set({ allowCalls: true }).where(eq(members.id, id.outsider))
  assert.equal(await codeOf(service.invite(as('ada'), meetingId, id.outsider)), 'not_found')
  await db.update(members).set({ handle: 'newcomer' }).where(eq(members.id, id.outsider))
  const config2 = { ...config, callsMembers: [...config.callsMembers, 'newcomer'] }
  const wide = new MeetingsService(db, rooms, config2)
  assert.equal(await codeOf(wide.invite(as('ada'), meetingId, id.outsider)), 'full')
})

test('capacity: a seat taken while someone stepped out is not theirs to take back', async () => {
  const guests: P[] = ['bayo', 'chi', 'dayo', 'ezi', 'funmi', 'gozie', 'hadiza']
  const meetingId = await meet('ada', guests, false)
  await service.join(as('bayo'), meetingId)
  await service.leave(as('bayo'), meetingId)
  await service.invite(as('ada'), meetingId, id.ife)
  for (const p of guests.slice(1)) await service.join(as(p), meetingId)
  await service.join(as('ife'), meetingId)
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'full')
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
})

test('lock: host only; a locked meeting takes no joins or invitations', async () => {
  const meetingId = await meet('ada', ['bayo'], false)
  assert.equal(await codeOf(service.setLocked(as('bayo'), meetingId, true)), 'not_found')
  const locked = await service.setLocked(as('ada'), meetingId, true)
  assert.equal(locked.locked, true)
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.invite(as('ada'), meetingId, id.chi)), 'locked')
  await service.setLocked(as('ada'), meetingId, false)
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'ok')
})

test('removing: host only; the member is disconnected, on the removed list, and gets no way back', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'])
  rooms.connect(meetingId, id.bayo)
  assert.equal(await codeOf(service.remove(as('bayo'), meetingId, id.chi)), 'not_found')
  assert.equal(await codeOf(service.remove(as('ada'), meetingId, id.ada)), 'not_found')
  assert.equal(await codeOf(service.remove(as('ada'), meetingId, id.outsider)), 'not_found')
  await service.remove(as('ada'), meetingId, id.bayo)
  assert.ok(rooms.removed.includes(`${meetingId}/${id.bayo}`))
  assert.equal(await stateOf(meetingId, 'bayo'), 'removed')
  assert.equal(await codeOf(service.token(as('bayo'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.join(as('bayo'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.get(as('bayo'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.invite(as('ada'), meetingId, id.bayo)), 'not_found')
  assert.equal(await service.incoming(as('bayo')), null)
})

test('leaving: you can come back; the last one out ends the meeting and drops the room', async () => {
  const meetingId = await meet('ada', ['bayo'])
  await service.leave(as('bayo'), meetingId)
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  assert.equal((await meetingRow(meetingId)).status, 'open')
  await service.leave(as('bayo'), meetingId)
  await service.join(as('bayo'), meetingId)
  assert.equal(await stateOf(meetingId, 'bayo'), 'joined')
  await service.leave(as('bayo'), meetingId)
  await service.leave(as('ada'), meetingId)
  assert.equal((await meetingRow(meetingId)).status, 'ended')
  assert.deepEqual(rooms.deleted, [meetingId])
  // Everyone is free to start or join another.
  await service.create(as('ada'), [])
})

test('when the host leaves, the longest-present participant becomes host, never nobody', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'], false)
  await service.join(as('chi'), meetingId)
  await new Promise((r) => setTimeout(r, 20))
  await service.join(as('bayo'), meetingId)
  await service.leave(as('ada'), meetingId)
  assert.equal((await meetingRow(meetingId)).hostId, id.chi)
  const view = await service.get(as('chi'), meetingId)
  assert.equal(view.role, 'host')
  assert.equal(await codeOf(service.setLocked(as('ada'), meetingId, true)), 'not_found')
  // A handover skips someone who is no longer eligible; if none can host, the meeting ends.
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.bayo))
  await service.leave(as('chi'), meetingId)
  assert.equal((await meetingRow(meetingId)).status, 'ended')
})

test('ending: host only, ends for everyone, drops the room and frees everyone', async () => {
  const meetingId = await meet('ada', ['bayo'])
  assert.equal(await codeOf(service.end(as('bayo'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.end(as('outsider'), meetingId)), 'not_found')
  await service.end(as('ada'), meetingId)
  assert.equal((await meetingRow(meetingId)).status, 'ended')
  assert.deepEqual(rooms.deleted, [meetingId])
  await service.end(as('ada'), meetingId)
  assert.equal(await codeOf(service.token(as('bayo'), meetingId)), 'not_found')
  await service.create(as('bayo'), [id.ada])
})

test('tokens: joined members only, microphone but no data channel, re-checked on live data', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'], false)
  await service.join(as('bayo'), meetingId)
  const t = await service.token(as('bayo'), meetingId)
  assert.equal(t.url, 'wss://livekit.test')
  const granted = token(t.token)
  assert.deepEqual(
    { room: granted.room, identity: granted.identity, canPublish: granted.canPublish, data: granted.canPublishData },
    { room: meetingId, identity: id.bayo, canPublish: true, data: false },
  )
  assert.equal(t.meeting.me, 'joined')
  // Invited but not joined, a stranger, or a missing meeting: nothing.
  assert.equal(await codeOf(service.token(as('chi'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.token(as('outsider'), meetingId)), 'not_found')
  assert.equal(await codeOf(service.token(as('bayo'), 'nope')), 'not_found')
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.bayo))
  assert.equal(await codeOf(service.token(as('bayo'), meetingId)), 'not_found')
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  // The host gets one too, and a locked meeting does not stop members already in it.
  await service.setLocked(as('ada'), meetingId, true)
  assert.equal(await codeOf(service.token(as('ada'), meetingId)), 'ok')
})

test('a block that arrives after joining stops a reconnect token for the blocked pair', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'])
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.chi })
  assert.equal(await codeOf(service.token(as('chi'), meetingId)), 'not_found')
})

test('the invitation search offers only members who pass canCall with the host, and not those already in', async () => {
  const meetingId = await meet('ada', ['bayo'])
  await db.insert(blocks).values({ blockerId: id.chi, blockedId: id.ada })
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.dayo))
  const found = (await service.invitable(as('ada'), meetingId, '')).map((p) => p.handle).sort()
  assert.deepEqual(found, ['ezi', 'funmi', 'gozie', 'hadiza', 'ife'])
  assert.deepEqual((await service.invitable(as('ada'), meetingId, 'FUN')).map((p) => p.handle), ['funmi'])
  assert.deepEqual(await service.invitable(as('ada'), meetingId, 'out'), [])
  assert.deepEqual(await service.invitable(as('ada'), meetingId, '%'), [])
  assert.equal(await codeOf(service.invitable(as('bayo'), meetingId, '')), 'not_found')
})

test('webhooks: joiners who are not in the meeting are removed; leaving follows the connection that left', async () => {
  const meetingId = await meet('ada', ['bayo'])
  await event('participant_joined', meetingId, 'ada', 'PA_1')
  assert.equal((await part(meetingId, 'ada'))?.sid, 'PA_1')
  await event('participant_joined', meetingId, 'chi', 'PA_x')
  assert.ok(rooms.removed.includes(`${meetingId}/${id.chi}`))
  await event('participant_joined', meetingId, 'bayo', 'PA_2')
  // A reload: the old connection's leave names an older sid and changes nothing.
  await event('participant_joined', meetingId, 'bayo', 'PA_3')
  await event('participant_left', meetingId, 'bayo', 'PA_2')
  assert.equal(await stateOf(meetingId, 'bayo'), 'joined')
  await event('participant_left', meetingId, 'bayo', 'PA_3')
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  await event('participant_left', meetingId, 'ada', 'PA_1')
  assert.equal((await meetingRow(meetingId)).status, 'ended')
  await event('participant_left', meetingId, 'ada', 'PA_1')
})

test('webhooks: a removed or ineligible joiner is thrown out, a finished room ends the meeting, strangers rooms are ignored', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'])
  await service.remove(as('ada'), meetingId, id.chi)
  rooms.removed.length = 0
  await event('participant_joined', meetingId, 'chi', 'PA_c')
  assert.deepEqual(rooms.removed, [`${meetingId}/${id.chi}`])
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.bayo))
  await event('participant_joined', meetingId, 'bayo', 'PA_b')
  assert.ok(rooms.removed.includes(`${meetingId}/${id.bayo}`))
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  await event('participant_joined', randomUUID(), 'ada')
  await event('room_finished', 'not-a-uuid')
  await event('room_finished', meetingId)
  assert.equal((await meetingRow(meetingId)).status, 'ended')
})

test('webhooks do nothing while calls are off', async () => {
  const meetingId = await meet('ada', ['bayo'])
  const off = new MeetingsService(db, rooms, { ...config, enabled: false })
  await off.handleEvent({ id: randomUUID(), kind: 'room_finished', room: meetingId, at: new Date() })
  assert.equal((await meetingRow(meetingId)).status, 'open')
})

test('reconcile: people who left the room, a vanished room, strangers in the room and stale invitations are settled', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'], false)
  await service.join(as('bayo'), meetingId)
  await aged(meetingId)
  rooms.connect(meetingId, id.ada)
  rooms.connect(meetingId, id.dayo)
  await db.update(meetingParticipants).set({ invitedAt: new Date(Date.now() - INVITE_TTL_MS - 1000) }).where(eq(meetingParticipants.memberId, id.chi))
  await service.reconcile()
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  assert.equal(await stateOf(meetingId, 'chi'), 'missed')
  assert.equal(await stateOf(meetingId, 'ada'), 'joined')
  assert.ok(rooms.removed.includes(`${meetingId}/${id.dayo}`))
  // The room is gone and the meeting is old: it ends.
  rooms.rooms.delete(meetingId)
  await service.reconcile()
  assert.equal((await meetingRow(meetingId)).status, 'ended')
})

test('reconcile: a new meeting is given time to connect', async () => {
  const meetingId = await meet('ada', ['bayo'])
  await service.reconcile()
  assert.equal((await meetingRow(meetingId)).status, 'open')
  assert.equal(await stateOf(meetingId, 'bayo'), 'joined')
})

test('reconcile: someone who stops being eligible is removed from the room', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi'])
  await aged(meetingId)
  for (const p of ['ada', 'bayo', 'chi'] as P[]) rooms.connect(meetingId, id[p])
  await db.update(members).set({ allowCalls: false }).where(eq(members.id, id.bayo))
  await service.reconcile()
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  assert.ok(rooms.removed.includes(`${meetingId}/${id.bayo}`))
  assert.equal(await stateOf(meetingId, 'chi'), 'joined')
})

test('reconcile: a block that arose inside the room removes the non-host of the pair, else the later joiner', async () => {
  const meetingId = await meet('ada', ['bayo', 'chi', 'dayo'], false)
  await service.join(as('bayo'), meetingId)
  await new Promise((r) => setTimeout(r, 20))
  await service.join(as('chi'), meetingId)
  await service.join(as('dayo'), meetingId)
  await aged(meetingId)
  for (const p of ['ada', 'bayo', 'chi', 'dayo'] as P[]) rooms.connect(meetingId, id[p])
  await db.update(meetingParticipants).set({ joinedAt: new Date(Date.now() - 8 * 60_000) }).where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.memberId, id.bayo)))
  // Chi blocks bayo: chi joined later, so chi leaves. Dayo blocks ada (the host): dayo leaves.
  await db.insert(blocks).values([
    { blockerId: id.chi, blockedId: id.bayo },
    { blockerId: id.dayo, blockedId: id.ada },
  ])
  await service.reconcile()
  assert.equal(await stateOf(meetingId, 'chi'), 'left')
  assert.equal(await stateOf(meetingId, 'dayo'), 'left')
  assert.equal(await stateOf(meetingId, 'bayo'), 'joined')
  assert.equal(await stateOf(meetingId, 'ada'), 'joined')
  assert.equal((await meetingRow(meetingId)).hostId, id.ada)
})

test('reconcile: a host who is gone from the room hands over; an empty meeting ends', async () => {
  const meetingId = await meet('ada', ['bayo'])
  await aged(meetingId)
  rooms.connect(meetingId, id.bayo)
  await service.reconcile()
  assert.equal((await meetingRow(meetingId)).hostId, id.bayo)
  assert.equal(await stateOf(meetingId, 'ada'), 'left')
  rooms.connected.clear()
  await service.reconcile()
  assert.equal((await meetingRow(meetingId)).status, 'ended')
})

test('with calls off the only thing that runs is the teardown: open meetings end and their rooms go', async () => {
  const meetingId = await meet('ada', ['bayo'])
  const finished = await meet('chi', [])
  await service.end(as('chi'), finished)
  rooms.deleted.length = 0
  const live = new MeetingsService(db, rooms, config)
  assert.equal(await live.tick(), 0)
  assert.equal((await meetingRow(meetingId)).status, 'open')
  const off = new MeetingsService(db, rooms, { ...config, enabled: false })
  assert.equal(await off.tick(), 1)
  assert.equal((await meetingRow(meetingId)).status, 'ended')
  assert.deepEqual(rooms.deleted, [meetingId])
  assert.equal(await stateOf(meetingId, 'bayo'), 'left')
  assert.equal(await off.tick(), 0)
})

test('the calls pass also runs the meetings pass (one timer, one kill switch)', async () => {
  const meetingId = await meet('ada', ['bayo'])
  const off = new CallsService(db, rooms, { ...config, enabled: false }, new MeetingsService(db, rooms, { ...config, enabled: false }))
  await off.tick()
  assert.equal((await meetingRow(meetingId)).status, 'ended')
  const second = await meet('chi', ['dayo'])
  await aged(second)
  rooms.rooms.delete(second)
  const on = new CallsService(db, rooms, config, new MeetingsService(db, rooms, config))
  await on.tick()
  assert.equal((await meetingRow(second)).status, 'ended')
})
