import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, gistMembers, gists, members } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { FakeRoomService, type FakeToken } from './fake-room-service.js'
import { GistError, GistsService, type GistsConfig } from './gists.service.js'

const people = ['ada', 'bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie', 'outsider'] as const
const id = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<(typeof people)[number], string>
const as = (p: (typeof people)[number]) => ({ id: id[p], handle: p })

const config: GistsConfig = {
  callsMembers: ['ada', 'bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie'],
  maxCohosts: 2,
  maxSpeakers: 2,
  listenerCap: 3,
  livekitUrl: 'wss://livekit.test',
}

let rooms: FakeRoomService
let service: GistsService

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (err: unknown) {
    assert.ok(err instanceof GistError, String(err))
    return err.code
  }
  return 'ok'
}

const token = (jwt: string) => JSON.parse(jwt) as FakeToken

/** Joins and connects to the (fake) room, the way a browser would. */
const enter = async (p: (typeof people)[number], gistId: string) => {
  const joined = await service.join(as(p), gistId)
  rooms.connect(gistId, id[p])
  return joined
}

const roleOf = async (gistId: string, p: (typeof people)[number]) =>
  (await db.select().from(gistMembers).where(and(eq(gistMembers.gistId, gistId), eq(gistMembers.memberId, id[p]))))[0]

let gist: string

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values(people.map((p) => ({ id: id[p], handle: p })))
  rooms = new FakeRoomService()
  service = new GistsService(db, rooms, config, new MemoryRateLimiter())
  gist = (await service.create(as('ada'), { title: 'Jollof wars' })).id
})
after(() => pool.end())

test('creating a Gist makes its room, with room for the cap, the host, co-hosts and speakers', async () => {
  assert.deepEqual(rooms.rooms.get(gist), { maxParticipants: 3 + 1 + 2 + 2, emptyTimeoutS: 300, departureTimeoutS: 120 })
  const view = await service.get(as('ada'), gist)
  assert.equal(view.status, 'live')
  assert.equal(view.host.handle, 'ada')
  assert.equal(view.viewer.role, 'host')
  assert.equal(view.listenerCount, 0)
})

test('only an eligible member can host, and a failed room leaves no live Gist behind', async () => {
  assert.equal(await codeOf(service.create(as('outsider'), { title: 'Hi' })), 'not_found')
  rooms.failNext = 'createRoom'
  assert.equal(await codeOf(service.create(as('bayo'), { title: 'Hi' })), 'livekit_unavailable')
  assert.equal((await db.select().from(gists).where(and(eq(gists.hostId, id.bayo), eq(gists.status, 'live')))).length, 0)
  assert.equal(await codeOf(service.create(as('bayo'), { title: 'Hi again' })), 'ok')
})

test('with the age gate in force the age result decides who hosts and joins, not the allow-list', async () => {
  const verified = new Set([id.outsider])
  const gated = new GistsService(db, rooms, config, new MemoryRateLimiter(), { adultGate: async (memberId) => verified.has(memberId) })
  // A verified adult who is not on the allow-list may host and join.
  const hosted = await gated.create(as('outsider'), { title: 'Verified' })
  assert.equal(await codeOf(gated.join(as('outsider'), hosted.id)), 'ok')
  // Someone on the allow-list but not verified may not.
  assert.equal(await codeOf(gated.create(as('bayo'), { title: 'Hi' })), 'not_found')
  assert.equal(await codeOf(gated.join(as('bayo'), hosted.id)), 'not_found')
  // The flag off for a member (undefined) leaves the allow-list in charge.
  const ungated = new GistsService(db, rooms, config, new MemoryRateLimiter(), { adultGate: async () => undefined })
  assert.equal(await codeOf(ungated.create(as('bayo'), { title: 'Allow-listed' })), 'ok')
  assert.equal(await codeOf(ungated.create(as('outsider'), { title: 'Not' })), 'not_found')
})

test('a host can have one live Gist at a time, even when two are started at once', async () => {
  assert.equal(await codeOf(service.create(as('ada'), { title: 'Second' })), 'already_hosting')
  const both = await Promise.all([
    codeOf(service.create(as('bayo'), { title: 'A' })),
    codeOf(service.create(as('bayo'), { title: 'B' })),
  ])
  assert.deepEqual([...both].sort(), ['already_hosting', 'ok'])
  await service.end(as('ada'), gist)
  assert.equal(await codeOf(service.create(as('ada'), { title: 'Another' })), 'ok')
})

test('every token only listens, whoever holds it', async () => {
  for (const p of ['ada', 'bayo'] as const) {
    const joined = await service.join(as(p), gist)
    const grants = token(joined.token)
    assert.equal(grants.identity, id[p])
    assert.equal(grants.room, gist)
    assert.equal(grants.canSubscribe, true)
    assert.equal(grants.canPublish, false)
    assert.equal(grants.canPublishData, false)
    assert.equal(grants.hidden, true)
  }
  assert.equal((await service.join(as('ada'), gist)).role, 'host')
  assert.equal((await service.join(as('bayo'), gist)).url, 'wss://livekit.test')
})

test('a member who is not on the allow-list gets the same not-found as a missing Gist', async () => {
  assert.equal(await codeOf(service.join(as('outsider'), gist)), 'not_found')
  assert.equal(await codeOf(service.get(as('outsider'), gist)), 'not_found')
  assert.equal(await codeOf(service.join(as('bayo'), randomUUID())), 'not_found')
})

test('a community-only Gist is for that community\'s members', async () => {
  const [lagos] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: 'x' }).returning()
  await db.insert(communityMemberships).values([
    { communityId: lagos!.id, memberId: id.dayo },
    { communityId: lagos!.id, memberId: id.efe },
  ])
  const own = await service.create(as('dayo'), { title: 'Lagos only', communityId: lagos!.id })
  assert.equal(await codeOf(service.join(as('efe'), own.id)), 'ok')
  assert.equal(await codeOf(service.join(as('bayo'), own.id)), 'not_found')
  // A host cannot open a Gist in a community they are not in.
  assert.equal(await codeOf(service.create(as('chi'), { title: 'x', communityId: lagos!.id })), 'not_found')
})

test('request to speak, approval, and the host\'s speaker limit', async () => {
  await enter('ada', gist)
  await enter('bayo', gist)
  await enter('chi', gist)
  await enter('dayo', gist)

  assert.equal(await codeOf(service.setSpeaker(as('bayo'), gist, id.chi)), 'forbidden')
  await service.requestToSpeak(as('bayo'), gist)
  await service.requestToSpeak(as('bayo'), gist) // one open request, asking again changes nothing
  assert.deepEqual((await service.requests(as('ada'), gist)).map((r) => r.handle), ['bayo'])
  assert.equal(await codeOf(service.requests(as('bayo'), gist)), 'forbidden')

  await service.setSpeaker(as('ada'), gist, id.bayo)
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: true, hidden: false })
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'speaker')
  assert.equal((await roleOf(gist, 'bayo'))!.speakRequestedAt, null)
  assert.equal((await service.requests(as('ada'), gist)).length, 0)

  // The host invites a listener who never asked.
  await service.setSpeaker(as('ada'), gist, id.chi)
  assert.equal((await roleOf(gist, 'chi'))!.role, 'speaker')
  // Two speakers is this test's limit.
  assert.equal(await codeOf(service.setSpeaker(as('ada'), gist, id.dayo)), 'speakers_full')
})

test('requests can be switched off by the host', async () => {
  await enter('bayo', gist)
  await service.updateSettings(as('ada'), gist, { requestsOpen: false })
  assert.equal(await codeOf(service.requestToSpeak(as('bayo'), gist)), 'requests_closed')
})

test('a co-host can moderate but not touch the host or other co-hosts; only the host appoints', async () => {
  await enter('ada', gist)
  await enter('bayo', gist)
  await enter('chi', gist)
  await enter('dayo', gist)
  assert.equal(await codeOf(service.setCohost(as('bayo'), gist, id.chi)), 'forbidden')
  await service.setCohost(as('ada'), gist, id.bayo)
  await service.setCohost(as('ada'), gist, id.chi)
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: true, hidden: false })
  // Co-hosts are limited to the configured two.
  assert.equal(await codeOf(service.setCohost(as('ada'), gist, id.dayo)), 'cohosts_full')

  assert.equal(await codeOf(service.remove(as('bayo'), gist, id.chi)), 'forbidden')
  assert.equal(await codeOf(service.remove(as('bayo'), gist, id.ada)), 'forbidden')
  assert.equal(await codeOf(service.mute(as('bayo'), gist, id.ada)), 'forbidden')
  assert.equal(await codeOf(service.end(as('bayo'), gist)), 'forbidden')
  assert.equal(await codeOf(service.remove(as('bayo'), gist, id.dayo)), 'ok')
  // The host can demote a co-host.
  await service.demote(as('ada'), gist, id.chi)
  assert.equal((await roleOf(gist, 'chi'))!.role, 'listener')
})

test('muting or demoting takes publish rights away and the speaker must ask again', async () => {
  await enter('bayo', gist)
  await service.requestToSpeak(as('bayo'), gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  assert.equal(rooms.permissionsOf(gist, id.bayo)!.canPublish, true)

  await service.mute(as('ada'), gist, id.bayo)
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: false, hidden: true })
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'listener')

  await service.setSpeaker(as('ada'), gist, id.bayo)
  await service.demote(as('bayo'), gist, id.bayo) // a speaker can step down themselves
  assert.equal(rooms.permissionsOf(gist, id.bayo)!.canPublish, false)
  // But a listener cannot demote anyone else.
  await enter('chi', gist)
  assert.equal(await codeOf(service.demote(as('chi'), gist, id.ada)), 'forbidden')
})

test('if LiveKit cannot revoke, the participant is disconnected, and the database already says listener', async () => {
  await enter('bayo', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  rooms.failNext = 'setPermissions'
  await service.demote(as('ada'), gist, id.bayo)
  assert.ok(rooms.removed.includes(`${gist}/${id.bayo}`))
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'listener')
})

test('rejoining after a demotion comes back as a listener', async () => {
  await enter('bayo', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  await service.demote(as('ada'), gist, id.bayo)
  rooms.connected.delete(`${gist}/${id.bayo}`)

  const again = await enter('bayo', gist)
  assert.equal(again.role, 'listener')
  assert.equal(token(again.token).canPublish, false)
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: false, hidden: true })
  // The webhook for that join leaves it that way.
  await service.handleWebhook(JSON.stringify({ id: 'e1', kind: 'participant_joined', room: gist, identity: id.bayo }), rooms.validAuthorization)
  assert.equal(rooms.permissionsOf(gist, id.bayo)!.canPublish, false)
})

test('a speaker who reconnects gets the microphone back from the database, not from the token', async () => {
  await enter('bayo', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  rooms.connected.delete(`${gist}/${id.bayo}`)

  const again = await enter('bayo', gist)
  assert.equal(again.role, 'speaker')
  assert.equal(token(again.token).canPublish, false)
  assert.equal(rooms.permissionsOf(gist, id.bayo)!.canPublish, false) // a fresh connection starts as a listener
  await service.handleWebhook(JSON.stringify({ id: 'e2', kind: 'participant_joined', room: gist, identity: id.bayo }), rooms.validAuthorization)
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: true, hidden: false })

  // The client can also ask for the reset itself once connected, in case the webhook is lost.
  rooms.permissions.set(`${gist}/${id.bayo}`, { canPublish: false, hidden: true })
  assert.equal((await service.sync(as('bayo'), gist)).role, 'speaker')
  assert.equal(rooms.permissionsOf(gist, id.bayo)!.canPublish, true)
})

test('the block rule is checked against the host and speakers, in both directions, and not between listeners', async () => {
  await enter('bayo', gist)
  await enter('chi', gist)
  await service.setSpeaker(as('ada'), gist, id.chi)

  await db.insert(blocks).values({ blockerId: id.dayo, blockedId: id.ada }) // dayo blocked the host
  await db.insert(blocks).values({ blockerId: id.chi, blockedId: id.efe }) // the speaker blocked efe
  await db.insert(blocks).values({ blockerId: id.femi, blockedId: id.chi }) // femi was blocked by the speaker's side too
  assert.equal(await codeOf(service.join(as('dayo'), gist)), 'not_found')
  assert.equal(await codeOf(service.join(as('efe'), gist)), 'not_found')
  assert.equal(await codeOf(service.join(as('femi'), gist)), 'not_found')

  // Two listeners who blocked each other can share the room.
  await db.insert(blocks).values({ blockerId: id.gozie, blockedId: id.bayo })
  assert.equal(await codeOf(service.join(as('gozie'), gist)), 'ok')
})

test('a listener is not promoted past the block check, and a host cannot promote someone blocked with a speaker', async () => {
  await enter('bayo', gist)
  await enter('chi', gist)
  await service.setSpeaker(as('ada'), gist, id.chi)
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.chi })
  assert.equal(await codeOf(service.setSpeaker(as('ada'), gist, id.bayo)), 'not_eligible')
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'listener')
})

test('the listener cap is a hard refusal, and rejoining does not take a second place', async () => {
  await enter('bayo', gist)
  await enter('chi', gist)
  await enter('dayo', gist)
  assert.equal(await codeOf(service.join(as('efe'), gist)), 'gist_full')
  assert.equal(await codeOf(service.join(as('dayo'), gist)), 'ok')
  // The host and speakers do not use up listener places.
  assert.equal(await codeOf(service.join(as('ada'), gist)), 'ok')
  await service.leave(as('dayo'), gist)
  assert.equal(await codeOf(service.join(as('efe'), gist)), 'ok')
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 3)
})

test('the cap holds when many join at once', async () => {
  const results = await Promise.all((['bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie'] as const).map((p) => codeOf(service.join(as(p), gist))))
  assert.equal(results.filter((r) => r === 'ok').length, 3)
  assert.equal(results.filter((r) => r === 'gist_full').length, 3)
})

test('a host can lower the cap and lock the room; people already in can reconnect', async () => {
  await enter('bayo', gist)
  await service.updateSettings(as('ada'), gist, { listenerCap: 1 })
  assert.equal(await codeOf(service.join(as('chi'), gist)), 'gist_full')
  await service.updateSettings(as('ada'), gist, { listenerCap: null, locked: true })
  assert.equal(await codeOf(service.join(as('chi'), gist)), 'gist_locked')
  assert.equal(await codeOf(service.join(as('bayo'), gist)), 'ok')
  assert.equal(await codeOf(service.updateSettings(as('bayo'), gist, { locked: false })), 'forbidden')
})

test('a removed member is disconnected and cannot get another token', async () => {
  await enter('bayo', gist)
  await service.requestToSpeak(as('bayo'), gist)
  await service.remove(as('ada'), gist, id.bayo)
  assert.ok(rooms.removed.includes(`${gist}/${id.bayo}`))
  const row = (await roleOf(gist, 'bayo'))!
  assert.ok(row.removedAt)
  assert.equal(row.removedBy, id.ada)
  assert.equal(row.speakRequestedAt, null)
  assert.equal(await codeOf(service.join(as('bayo'), gist)), 'not_found')
  assert.equal(await codeOf(service.requestToSpeak(as('bayo'), gist)), 'not_found')
  // A webhook for a removed member who is somehow still connected removes them again.
  rooms.connect(gist, id.bayo)
  await service.handleWebhook(JSON.stringify({ id: 'e3', kind: 'participant_joined', room: gist, identity: id.bayo }), rooms.validAuthorization)
  assert.equal(rooms.removed.filter((r) => r === `${gist}/${id.bayo}`).length, 2)
  // Removed members are not counted as listeners.
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 0)
})

test('ending a Gist deletes the room, and nobody can join it afterwards', async () => {
  await enter('bayo', gist)
  await service.end(as('ada'), gist)
  await service.end(as('ada'), gist) // idempotent
  assert.deepEqual(rooms.deleted.slice(0, 1), [gist])
  const view = await service.get(as('bayo'), gist)
  assert.equal(view.status, 'ended')
  assert.equal(await codeOf(service.join(as('chi'), gist)), 'gist_ended')
  assert.equal((await roleOf(gist, 'bayo'))!.leftAt instanceof Date, true)
})

test('webhooks: a bad signature is refused, and the events keep the database in line', async () => {
  const body = (event: object) => JSON.stringify(event)
  await assert.rejects(service.handleWebhook(body({ id: 'x', kind: 'room_finished', room: gist }), 'forged'), /bad signature/)

  await enter('bayo', gist)
  await service.handleWebhook(body({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo }), rooms.validAuthorization)
  assert.ok((await roleOf(gist, 'bayo'))!.leftAt)
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 0)

  // A member nobody let in, connected anyway, is removed.
  rooms.connect(gist, id.chi)
  await service.handleWebhook(body({ id: 'j1', kind: 'participant_joined', room: gist, identity: id.chi }), rooms.validAuthorization)
  assert.ok(rooms.removed.includes(`${gist}/${id.chi}`))

  await service.handleWebhook(body({ id: 'f1', kind: 'room_finished', room: gist }), rooms.validAuthorization)
  assert.equal((await service.get(as('ada'), gist)).status, 'ended')
  // Replays and unknown rooms change nothing.
  await service.handleWebhook(body({ id: 'f1', kind: 'room_finished', room: gist }), rooms.validAuthorization)
  await service.handleWebhook(body({ id: 'f2', kind: 'room_finished', room: randomUUID() }), rooms.validAuthorization)
  await service.handleWebhook(body({ id: 'o1', kind: 'other' }), rooms.validAuthorization)
})

const hook = (event: object) => JSON.stringify(event)
const send = (event: object) => service.handleWebhook(hook(event), rooms.validAuthorization)

test('a leave in the same second as the join still counts (LiveKit stamps whole seconds)', async () => {
  await enter('bayo', gist)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_1' })
  assert.ok((await roleOf(gist, 'bayo'))!.leftAt)
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 0)
})

test('a left event from the connection a reload replaced does not mark the member as gone', async () => {
  await enter('bayo', gist)
  await send({ id: 'j1', kind: 'participant_joined', room: gist, identity: id.bayo, sid: 'PA_old' })
  await enter('bayo', gist) // reload: /join again while the old connection is still open
  await send({ id: 'j2', kind: 'participant_joined', room: gist, identity: id.bayo, sid: 'PA_new' })
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_old' })
  const row = (await roleOf(gist, 'bayo'))!
  assert.equal(row.leftAt, null)
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 1)
  await service.requestToSpeak(as('bayo'), gist)
})

test('the old connection leave arriving before the new join is put right by the join', async () => {
  await enter('bayo', gist)
  await send({ id: 'j1', kind: 'participant_joined', room: gist, identity: id.bayo, sid: 'PA_old' })
  await enter('bayo', gist)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_old' })
  assert.ok((await roleOf(gist, 'bayo'))!.leftAt)
  await send({ id: 'j2', kind: 'participant_joined', room: gist, identity: id.bayo, sid: 'PA_new' })
  assert.equal((await roleOf(gist, 'bayo'))!.leftAt, null)
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 1)
})

test('syncing from a connected client marks them present, in case the join webhook was lost', async () => {
  await enter('bayo', gist)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_1' })
  await service.sync(as('bayo'), gist)
  assert.equal((await roleOf(gist, 'bayo'))!.leftAt, null)
})

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('a sync that read "speaker" cannot give the microphone back after a demotion', async () => {
  await enter('bayo', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  let release!: () => void
  rooms.holdNext = new Promise<void>((r) => (release = r))
  const slow = service.sync(as('bayo'), gist) // read the role, its LiveKit call is still on the way
  await pause(50)
  const demotion = service.demote(as('ada'), gist, id.bayo)
  await pause(50)
  release()
  await Promise.all([slow, demotion])
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'listener')
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: false, hidden: true })
})

test('a promotion whose LiveKit call is slow cannot outlive a demotion that follows', async () => {
  await enter('bayo', gist)
  let release!: () => void
  rooms.holdNext = new Promise<void>((r) => (release = r))
  const promotion = service.setSpeaker(as('ada'), gist, id.bayo)
  await pause(50)
  const demotion = service.demote(as('ada'), gist, id.bayo)
  await pause(50)
  release()
  await Promise.all([promotion, demotion])
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'listener')
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: false, hidden: true })
})

test('a webhook join that read "speaker" cannot give the microphone back after a mute', async () => {
  await enter('bayo', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  let release!: () => void
  rooms.holdNext = new Promise<void>((r) => (release = r))
  const slow = send({ id: 'j1', kind: 'participant_joined', room: gist, identity: id.bayo, sid: 'PA_1' })
  await pause(50)
  const mute = service.mute(as('ada'), gist, id.bayo)
  await pause(50)
  release()
  await Promise.all([slow, mute])
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: false, hidden: true })
})

test('a host who is already live is told which Gist is theirs, so they can go back to it', async () => {
  const err = await service.create(as('ada'), { title: 'Second' }).then(
    () => undefined,
    (e: unknown) => e,
  )
  assert.ok(err instanceof GistError)
  assert.equal(err.code, 'already_hosting')
  assert.deepEqual(err.details, { gistId: gist })
})

// The window between join's read and its write is too small to hit from here, so this
// checks the end state; the Gist row lock both take is what rules the overlap out.
test('a removal while a join is in flight leaves the member removed and out of the room', async () => {
  for (const p of ['bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie'] as const) {
    await enter(p, gist)
    await Promise.all([codeOf(service.join(as(p), gist)), service.remove(as('ada'), gist, id[p])])
    const row = (await roleOf(gist, p))!
    assert.ok(row.removedAt)
    assert.ok(row.leftAt, `${p} was written back in after the removal`)
    assert.equal(await codeOf(service.join(as(p), gist)), 'not_found')
  }
})

test('a sync from a client LiveKit does not have leaves the member marked as gone', async () => {
  await enter('bayo', gist)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_1' })
  rooms.connected.delete(`${gist}/${id.bayo}`)
  assert.equal(await codeOf(service.sync(as('bayo'), gist)), 'not_in_gist')
  assert.ok((await roleOf(gist, 'bayo'))!.leftAt)
})

test('members who may not join a Gist do not use up its join allowance', async () => {
  for (let i = 0; i < 130; i++) assert.equal(await codeOf(service.join(as('outsider'), gist)), 'not_found')
  assert.equal(await codeOf(service.join(as('bayo'), gist)), 'ok')
})

test('a listener brought back by a webhook or a sync still needs a place under the cap', async () => {
  await enter('bayo', gist)
  await enter('chi', gist)
  await enter('dayo', gist)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_1' }) // counted as gone
  await enter('efe', gist) // takes the place
  await send({ id: 'j1', kind: 'participant_joined', room: gist, identity: id.bayo, sid: 'PA_2' })
  assert.ok(rooms.removed.includes(`${gist}/${id.bayo}`))
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 3)
  rooms.connect(gist, id.bayo)
  assert.equal(await codeOf(service.sync(as('bayo'), gist)), 'gist_full')
  assert.ok(rooms.removed.filter((r) => r === `${gist}/${id.bayo}`).length >= 2)
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 3)
})

// ---- reconcile ----------------------------------------------------------------

const later = (ms: number) => new Date(Date.now() + ms)
const MINUTE = 60_000

test('reconcile: a Gist whose room is gone ends, as if its room_finished had arrived', async () => {
  await enter('ada', gist)
  rooms.rooms.delete(gist)
  await service.reconcile(later(MINUTE))
  assert.equal((await service.get(as('ada'), gist)).status, 'ended')
})

test('reconcile: someone who may no longer be there is disconnected', async () => {
  await enter('ada', gist)
  await enter('bayo', gist)
  await db.update(members).set({ active: false }).where(eq(members.id, id.bayo)) // suspended mid-Gist
  await service.reconcile(later(MINUTE))
  assert.ok(rooms.removed.includes(`${gist}/${id.bayo}`))
  assert.ok(!rooms.removed.includes(`${gist}/${id.ada}`))
})

test('reconcile: permissions that drifted from the role are put back', async () => {
  await enter('ada', gist)
  await enter('bayo', gist)
  await enter('chi', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  rooms.permissions.set(`${gist}/${id.bayo}`, { canPublish: false, hidden: true })
  rooms.permissions.set(`${gist}/${id.chi}`, { canPublish: true, hidden: false })
  await service.reconcile(later(MINUTE))
  assert.deepEqual(rooms.permissionsOf(gist, id.bayo), { canPublish: true, hidden: false })
  assert.deepEqual(rooms.permissionsOf(gist, id.chi), { canPublish: false, hidden: true })
})

test('reconcile: a member LiveKit does not have is marked gone, but not while they are still connecting', async () => {
  await db.update(gists).set({ startedAt: new Date(Date.now() - 10 * MINUTE) }).where(eq(gists.id, gist))
  await enter('ada', gist)
  await service.join(as('bayo'), gist) // a token, not connected yet
  await service.reconcile(later(10_000))
  assert.equal((await roleOf(gist, 'bayo'))!.leftAt, null)
  await service.reconcile(later(MINUTE))
  assert.ok((await roleOf(gist, 'bayo'))!.leftAt)
  assert.equal((await service.get(as('ada'), gist)).listenerCount, 0)
  assert.equal((await roleOf(gist, 'ada'))!.leftAt, null)
})

test('reconcile: a speaker gone for two minutes goes back to the audience and frees the slot', async () => {
  await enter('ada', gist)
  await enter('bayo', gist)
  await service.setSpeaker(as('ada'), gist, id.bayo)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.bayo, sid: 'PA_1' })
  rooms.connected.delete(`${gist}/${id.bayo}`)
  await service.reconcile(later(MINUTE))
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'speaker')
  await service.reconcile(later(3 * MINUTE))
  assert.equal((await roleOf(gist, 'bayo'))!.role, 'listener')
  assert.equal((await service.get(as('ada'), gist)).status, 'live')
})

test('reconcile: a Gist whose host has been gone two minutes ends, and so does one the host never came to', async () => {
  await enter('ada', gist)
  await send({ id: 'l1', kind: 'participant_left', room: gist, identity: id.ada, sid: 'PA_1' })
  rooms.connected.delete(`${gist}/${id.ada}`)
  await service.reconcile(later(MINUTE))
  assert.equal((await service.get(as('ada'), gist)).status, 'live')
  await service.reconcile(later(3 * MINUTE))
  assert.equal((await service.get(as('ada'), gist)).status, 'ended')
  assert.ok(rooms.deleted.includes(gist))

  const other = (await service.create(as('bayo'), { title: 'Never came' })).id
  await service.reconcile(later(3 * MINUTE))
  assert.equal((await service.get(as('bayo'), other)).status, 'ended')
})
