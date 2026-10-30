import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, members, spaceMembers, spaces } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { FakeRoomService, type FakeToken } from './fake-room-service.js'
import { SpaceError, SpacesService, type SpacesConfig } from './spaces.service.js'

const people = ['ada', 'bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie', 'outsider'] as const
const id = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<(typeof people)[number], string>
const as = (p: (typeof people)[number]) => ({ id: id[p], handle: p })

const config: SpacesConfig = {
  callsMembers: ['ada', 'bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie'],
  maxCohosts: 2,
  maxSpeakers: 2,
  listenerCap: 3,
  livekitUrl: 'wss://livekit.test',
}

let rooms: FakeRoomService
let service: SpacesService

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (err: unknown) {
    assert.ok(err instanceof SpaceError, String(err))
    return err.code
  }
  return 'ok'
}

const token = (jwt: string) => JSON.parse(jwt) as FakeToken

/** Joins and connects to the (fake) room, the way a browser would. */
const enter = async (p: (typeof people)[number], spaceId: string) => {
  const joined = await service.join(as(p), spaceId)
  rooms.connect(spaceId, id[p])
  return joined
}

const roleOf = async (spaceId: string, p: (typeof people)[number]) =>
  (await db.select().from(spaceMembers).where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.memberId, id[p]))))[0]

let space: string

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values(people.map((p) => ({ id: id[p], handle: p })))
  rooms = new FakeRoomService()
  service = new SpacesService(db, rooms, config)
  space = (await service.create(as('ada'), { title: 'Jollof wars' })).id
})
after(() => pool.end())

test('creating a Space makes its room, with room for the cap, the host, co-hosts and speakers', async () => {
  assert.deepEqual(rooms.rooms.get(space), { maxParticipants: 3 + 1 + 2 + 2, emptyTimeoutS: 300 })
  const view = await service.get(as('ada'), space)
  assert.equal(view.status, 'live')
  assert.equal(view.host.handle, 'ada')
  assert.equal(view.viewer.role, 'host')
  assert.equal(view.listenerCount, 0)
})

test('only an eligible member can host, and a failed room leaves no live Space behind', async () => {
  assert.equal(await codeOf(service.create(as('outsider'), { title: 'Hi' })), 'not_found')
  rooms.failNext = 'createRoom'
  assert.equal(await codeOf(service.create(as('bayo'), { title: 'Hi' })), 'livekit_unavailable')
  assert.equal((await db.select().from(spaces).where(and(eq(spaces.hostId, id.bayo), eq(spaces.status, 'live')))).length, 0)
  assert.equal(await codeOf(service.create(as('bayo'), { title: 'Hi again' })), 'ok')
})

test('a host can have one live Space at a time, even when two are started at once', async () => {
  assert.equal(await codeOf(service.create(as('ada'), { title: 'Second' })), 'already_hosting')
  const both = await Promise.all([
    codeOf(service.create(as('bayo'), { title: 'A' })),
    codeOf(service.create(as('bayo'), { title: 'B' })),
  ])
  assert.deepEqual([...both].sort(), ['already_hosting', 'ok'])
  await service.end(as('ada'), space)
  assert.equal(await codeOf(service.create(as('ada'), { title: 'Another' })), 'ok')
})

test('every token only listens, whoever holds it', async () => {
  for (const p of ['ada', 'bayo'] as const) {
    const joined = await service.join(as(p), space)
    const grants = token(joined.token)
    assert.equal(grants.identity, id[p])
    assert.equal(grants.room, space)
    assert.equal(grants.canSubscribe, true)
    assert.equal(grants.canPublish, false)
    assert.equal(grants.canPublishData, false)
    assert.equal(grants.hidden, true)
  }
  assert.equal((await service.join(as('ada'), space)).role, 'host')
  assert.equal((await service.join(as('bayo'), space)).url, 'wss://livekit.test')
})

test('a member who is not on the allow-list gets the same not-found as a missing Space', async () => {
  assert.equal(await codeOf(service.join(as('outsider'), space)), 'not_found')
  assert.equal(await codeOf(service.get(as('outsider'), space)), 'not_found')
  assert.equal(await codeOf(service.join(as('bayo'), randomUUID())), 'not_found')
})

test('a community-only Space is for that community\'s members', async () => {
  const [lagos] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: 'x' }).returning()
  await db.insert(communityMemberships).values([
    { communityId: lagos!.id, memberId: id.dayo },
    { communityId: lagos!.id, memberId: id.efe },
  ])
  const own = await service.create(as('dayo'), { title: 'Lagos only', communityId: lagos!.id })
  assert.equal(await codeOf(service.join(as('efe'), own.id)), 'ok')
  assert.equal(await codeOf(service.join(as('bayo'), own.id)), 'not_found')
  // A host cannot open a Space in a community they are not in.
  assert.equal(await codeOf(service.create(as('chi'), { title: 'x', communityId: lagos!.id })), 'not_found')
})

test('request to speak, approval, and the host\'s speaker limit', async () => {
  await enter('ada', space)
  await enter('bayo', space)
  await enter('chi', space)
  await enter('dayo', space)

  assert.equal(await codeOf(service.setSpeaker(as('bayo'), space, id.chi)), 'forbidden')
  await service.requestToSpeak(as('bayo'), space)
  await service.requestToSpeak(as('bayo'), space) // one open request, asking again changes nothing
  assert.deepEqual((await service.requests(as('ada'), space)).map((r) => r.handle), ['bayo'])
  assert.equal(await codeOf(service.requests(as('bayo'), space)), 'forbidden')

  await service.setSpeaker(as('ada'), space, id.bayo)
  assert.deepEqual(rooms.permissionsOf(space, id.bayo), { canPublish: true, hidden: false })
  assert.equal((await roleOf(space, 'bayo'))!.role, 'speaker')
  assert.equal((await roleOf(space, 'bayo'))!.speakRequestedAt, null)
  assert.equal((await service.requests(as('ada'), space)).length, 0)

  // The host invites a listener who never asked.
  await service.setSpeaker(as('ada'), space, id.chi)
  assert.equal((await roleOf(space, 'chi'))!.role, 'speaker')
  // Two speakers is this test's limit.
  assert.equal(await codeOf(service.setSpeaker(as('ada'), space, id.dayo)), 'speakers_full')
})

test('requests can be switched off by the host', async () => {
  await enter('bayo', space)
  await service.updateSettings(as('ada'), space, { requestsOpen: false })
  assert.equal(await codeOf(service.requestToSpeak(as('bayo'), space)), 'requests_closed')
})

test('a co-host can moderate but not touch the host or other co-hosts; only the host appoints', async () => {
  await enter('ada', space)
  await enter('bayo', space)
  await enter('chi', space)
  await enter('dayo', space)
  assert.equal(await codeOf(service.setCohost(as('bayo'), space, id.chi)), 'forbidden')
  await service.setCohost(as('ada'), space, id.bayo)
  await service.setCohost(as('ada'), space, id.chi)
  assert.deepEqual(rooms.permissionsOf(space, id.bayo), { canPublish: true, hidden: false })
  // Co-hosts are limited to the configured two.
  assert.equal(await codeOf(service.setCohost(as('ada'), space, id.dayo)), 'cohosts_full')

  assert.equal(await codeOf(service.remove(as('bayo'), space, id.chi)), 'forbidden')
  assert.equal(await codeOf(service.remove(as('bayo'), space, id.ada)), 'forbidden')
  assert.equal(await codeOf(service.mute(as('bayo'), space, id.ada)), 'forbidden')
  assert.equal(await codeOf(service.end(as('bayo'), space)), 'forbidden')
  assert.equal(await codeOf(service.remove(as('bayo'), space, id.dayo)), 'ok')
  // The host can demote a co-host.
  await service.demote(as('ada'), space, id.chi)
  assert.equal((await roleOf(space, 'chi'))!.role, 'listener')
})

test('muting or demoting takes publish rights away and the speaker must ask again', async () => {
  await enter('bayo', space)
  await service.requestToSpeak(as('bayo'), space)
  await service.setSpeaker(as('ada'), space, id.bayo)
  assert.equal(rooms.permissionsOf(space, id.bayo)!.canPublish, true)

  await service.mute(as('ada'), space, id.bayo)
  assert.deepEqual(rooms.permissionsOf(space, id.bayo), { canPublish: false, hidden: true })
  assert.equal((await roleOf(space, 'bayo'))!.role, 'listener')

  await service.setSpeaker(as('ada'), space, id.bayo)
  await service.demote(as('bayo'), space, id.bayo) // a speaker can step down themselves
  assert.equal(rooms.permissionsOf(space, id.bayo)!.canPublish, false)
  // But a listener cannot demote anyone else.
  await enter('chi', space)
  assert.equal(await codeOf(service.demote(as('chi'), space, id.ada)), 'forbidden')
})

test('if LiveKit cannot revoke, the participant is disconnected, and the database already says listener', async () => {
  await enter('bayo', space)
  await service.setSpeaker(as('ada'), space, id.bayo)
  rooms.failNext = 'setPermissions'
  await service.demote(as('ada'), space, id.bayo)
  assert.ok(rooms.removed.includes(`${space}/${id.bayo}`))
  assert.equal((await roleOf(space, 'bayo'))!.role, 'listener')
})

test('rejoining after a demotion comes back as a listener', async () => {
  await enter('bayo', space)
  await service.setSpeaker(as('ada'), space, id.bayo)
  await service.demote(as('ada'), space, id.bayo)
  rooms.connected.delete(`${space}/${id.bayo}`)

  const again = await enter('bayo', space)
  assert.equal(again.role, 'listener')
  assert.equal(token(again.token).canPublish, false)
  assert.deepEqual(rooms.permissionsOf(space, id.bayo), { canPublish: false, hidden: true })
  // The webhook for that join leaves it that way.
  await service.handleWebhook(JSON.stringify({ id: 'e1', kind: 'participant_joined', room: space, identity: id.bayo }), rooms.validAuthorization)
  assert.equal(rooms.permissionsOf(space, id.bayo)!.canPublish, false)
})

test('a speaker who reconnects gets the microphone back from the database, not from the token', async () => {
  await enter('bayo', space)
  await service.setSpeaker(as('ada'), space, id.bayo)
  rooms.connected.delete(`${space}/${id.bayo}`)

  const again = await enter('bayo', space)
  assert.equal(again.role, 'speaker')
  assert.equal(token(again.token).canPublish, false)
  assert.equal(rooms.permissionsOf(space, id.bayo)!.canPublish, false) // a fresh connection starts as a listener
  await service.handleWebhook(JSON.stringify({ id: 'e2', kind: 'participant_joined', room: space, identity: id.bayo }), rooms.validAuthorization)
  assert.deepEqual(rooms.permissionsOf(space, id.bayo), { canPublish: true, hidden: false })

  // The client can also ask for the reset itself once connected, in case the webhook is lost.
  rooms.permissions.set(`${space}/${id.bayo}`, { canPublish: false, hidden: true })
  assert.equal((await service.sync(as('bayo'), space)).role, 'speaker')
  assert.equal(rooms.permissionsOf(space, id.bayo)!.canPublish, true)
})

test('the block rule is checked against the host and speakers, in both directions, and not between listeners', async () => {
  await enter('bayo', space)
  await enter('chi', space)
  await service.setSpeaker(as('ada'), space, id.chi)

  await db.insert(blocks).values({ blockerId: id.dayo, blockedId: id.ada }) // dayo blocked the host
  await db.insert(blocks).values({ blockerId: id.chi, blockedId: id.efe }) // the speaker blocked efe
  await db.insert(blocks).values({ blockerId: id.femi, blockedId: id.chi }) // femi was blocked by the speaker's side too
  assert.equal(await codeOf(service.join(as('dayo'), space)), 'not_found')
  assert.equal(await codeOf(service.join(as('efe'), space)), 'not_found')
  assert.equal(await codeOf(service.join(as('femi'), space)), 'not_found')

  // Two listeners who blocked each other can share the room.
  await db.insert(blocks).values({ blockerId: id.gozie, blockedId: id.bayo })
  assert.equal(await codeOf(service.join(as('gozie'), space)), 'ok')
})

test('a listener is not promoted past the block check, and a host cannot promote someone blocked with a speaker', async () => {
  await enter('bayo', space)
  await enter('chi', space)
  await service.setSpeaker(as('ada'), space, id.chi)
  await db.insert(blocks).values({ blockerId: id.bayo, blockedId: id.chi })
  assert.equal(await codeOf(service.setSpeaker(as('ada'), space, id.bayo)), 'not_eligible')
  assert.equal((await roleOf(space, 'bayo'))!.role, 'listener')
})

test('the listener cap is a hard refusal, and rejoining does not take a second place', async () => {
  await enter('bayo', space)
  await enter('chi', space)
  await enter('dayo', space)
  assert.equal(await codeOf(service.join(as('efe'), space)), 'space_full')
  assert.equal(await codeOf(service.join(as('dayo'), space)), 'ok')
  // The host and speakers do not use up listener places.
  assert.equal(await codeOf(service.join(as('ada'), space)), 'ok')
  await service.leave(as('dayo'), space)
  assert.equal(await codeOf(service.join(as('efe'), space)), 'ok')
  assert.equal((await service.get(as('ada'), space)).listenerCount, 3)
})

test('the cap holds when many join at once', async () => {
  const results = await Promise.all((['bayo', 'chi', 'dayo', 'efe', 'femi', 'gozie'] as const).map((p) => codeOf(service.join(as(p), space))))
  assert.equal(results.filter((r) => r === 'ok').length, 3)
  assert.equal(results.filter((r) => r === 'space_full').length, 3)
})

test('a host can lower the cap and lock the room; people already in can reconnect', async () => {
  await enter('bayo', space)
  await service.updateSettings(as('ada'), space, { listenerCap: 1 })
  assert.equal(await codeOf(service.join(as('chi'), space)), 'space_full')
  await service.updateSettings(as('ada'), space, { listenerCap: null, locked: true })
  assert.equal(await codeOf(service.join(as('chi'), space)), 'space_locked')
  assert.equal(await codeOf(service.join(as('bayo'), space)), 'ok')
  assert.equal(await codeOf(service.updateSettings(as('bayo'), space, { locked: false })), 'forbidden')
})

test('a removed member is disconnected and cannot get another token', async () => {
  await enter('bayo', space)
  await service.requestToSpeak(as('bayo'), space)
  await service.remove(as('ada'), space, id.bayo)
  assert.ok(rooms.removed.includes(`${space}/${id.bayo}`))
  const row = (await roleOf(space, 'bayo'))!
  assert.ok(row.removedAt)
  assert.equal(row.removedBy, id.ada)
  assert.equal(row.speakRequestedAt, null)
  assert.equal(await codeOf(service.join(as('bayo'), space)), 'not_found')
  assert.equal(await codeOf(service.requestToSpeak(as('bayo'), space)), 'not_found')
  // A webhook for a removed member who is somehow still connected removes them again.
  rooms.connect(space, id.bayo)
  await service.handleWebhook(JSON.stringify({ id: 'e3', kind: 'participant_joined', room: space, identity: id.bayo }), rooms.validAuthorization)
  assert.equal(rooms.removed.filter((r) => r === `${space}/${id.bayo}`).length, 2)
  // Removed members are not counted as listeners.
  assert.equal((await service.get(as('ada'), space)).listenerCount, 0)
})

test('ending a Space deletes the room, and nobody can join it afterwards', async () => {
  await enter('bayo', space)
  await service.end(as('ada'), space)
  await service.end(as('ada'), space) // idempotent
  assert.deepEqual(rooms.deleted.slice(0, 1), [space])
  const view = await service.get(as('bayo'), space)
  assert.equal(view.status, 'ended')
  assert.equal(await codeOf(service.join(as('chi'), space)), 'space_ended')
  assert.equal((await roleOf(space, 'bayo'))!.leftAt instanceof Date, true)
})

test('webhooks: a bad signature is refused, and the events keep the database in line', async () => {
  const body = (event: object) => JSON.stringify(event)
  await assert.rejects(service.handleWebhook(body({ id: 'x', kind: 'room_finished', room: space }), 'forged'), /bad signature/)

  await enter('bayo', space)
  await service.handleWebhook(body({ id: 'l1', kind: 'participant_left', room: space, identity: id.bayo }), rooms.validAuthorization)
  assert.ok((await roleOf(space, 'bayo'))!.leftAt)
  assert.equal((await service.get(as('ada'), space)).listenerCount, 0)

  // A member nobody let in, connected anyway, is removed.
  rooms.connect(space, id.chi)
  await service.handleWebhook(body({ id: 'j1', kind: 'participant_joined', room: space, identity: id.chi }), rooms.validAuthorization)
  assert.ok(rooms.removed.includes(`${space}/${id.chi}`))

  await service.handleWebhook(body({ id: 'f1', kind: 'room_finished', room: space }), rooms.validAuthorization)
  assert.equal((await service.get(as('ada'), space)).status, 'ended')
  // Replays and unknown rooms change nothing.
  await service.handleWebhook(body({ id: 'f1', kind: 'room_finished', room: space }), rooms.validAuthorization)
  await service.handleWebhook(body({ id: 'f2', kind: 'room_finished', room: randomUUID() }), rooms.validAuthorization)
  await service.handleWebhook(body({ id: 'o1', kind: 'other' }), rooms.validAuthorization)
})

test('a left event from an old connection does not mark someone who has since rejoined as gone', async () => {
  await enter('bayo', space)
  const staleLeft = { id: 'old', kind: 'participant_left', room: space, identity: id.bayo }
  await new Promise((r) => setTimeout(r, 20))
  await enter('bayo', space) // joined again after the old connection ended
  // The event time is taken as "now" by the fake, so make it older than the rejoin.
  const real = rooms.readWebhook.bind(rooms)
  rooms.readWebhook = async (b, a) => ({ ...(await real(b, a)), at: new Date(Date.now() - 10_000) })
  await service.handleWebhook(JSON.stringify(staleLeft), rooms.validAuthorization)
  assert.equal((await roleOf(space, 'bayo'))!.leftAt, null)
})
