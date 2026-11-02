import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, privacyRequests } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { PrivacyRequestError, PrivacyRequestsService } from './privacy-requests.service.js'

const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-10-30T09:00:00Z')
const days = (n: number) => new Date(now.getTime() + n * DAY)
const requests = new PrivacyRequestsService(db, { PRIVACY_REQUEST_DUE_DAYS: 30 })
const ada = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values({ id: ada, handle: 'ada' })
})
after(() => pool.end())

const row = async (id: string) => (await db.select().from(privacyRequests).where(eq(privacyRequests.id, id)))[0]!

test('a request still open after its due date is overdue, oldest first; a closed one never is', async () => {
  const rows = await db
    .insert(privacyRequests)
    .values([
      { kind: 'access', channel: 'email', status: 'received', receivedAt: days(-31), dueBy: days(-1) },
      { kind: 'deletion', channel: 'self_service', status: 'in_progress', receivedAt: days(-40), dueBy: days(-10) },
      { kind: 'correction', channel: 'email', status: 'verifying', receivedAt: days(-29), dueBy: days(1) },
      { kind: 'deletion', channel: 'self_service', status: 'completed', receivedAt: days(-40), dueBy: days(-10), closedAt: days(-26) },
      { kind: 'objection', channel: 'email', status: 'refused', receivedAt: days(-40), dueBy: days(-10), closedAt: days(-12) },
      { kind: 'deletion', channel: 'self_service', status: 'cancelled', receivedAt: days(-40), dueBy: days(-10), closedAt: days(-39) },
    ])
    .returning({ id: privacyRequests.id })

  assert.deepEqual(await requests.overdue(now), [
    { id: rows[1]!.id, kind: 'deletion', dueBy: days(-10) },
    { id: rows[0]!.id, kind: 'access', dueBy: days(-1) },
  ])
  assert.equal((await requests.overdue(days(2))).length, 3, 'the one being verified, once its day has passed')
  assert.deepEqual((await requests.open()).map((r) => r.id), [rows[1]!.id, rows[0]!.id, rows[2]!.id])
})

test('a request by email is recorded as it arrives, due PRIVACY_REQUEST_DUE_DAYS later, with or without an account', async () => {
  const mine = await requests.record({ memberId: ada, kind: 'access', notes: 'asked by email on 30 October' }, now)
  const stranger = await requests.record({ memberId: null, kind: 'objection' }, now)
  assert.deepEqual(mine.dueBy, days(30))
  const recorded = await row(mine.id)
  assert.deepEqual(
    [recorded.memberId, recorded.kind, recorded.channel, recorded.status, recorded.receivedAt, recorded.notes, recorded.closedAt],
    [ada, 'access', 'email', 'received', now, 'asked by email on 30 October', null],
  )
  assert.deepEqual(
    (await requests.open()).map((r) => [r.id, r.handle]),
    [[mine.id, 'ada'], [stranger.id, null]],
  )
})

test('closing answers or refuses a request once, keeping what was noted', async () => {
  const { id } = await requests.record({ memberId: ada, kind: 'access', notes: 'asked by email' }, now)
  await requests.close(id, { notes: 'sent the export' }, days(3))
  const closed = await row(id)
  assert.deepEqual([closed.status, closed.closedAt, closed.notes], ['completed', days(3), 'asked by email\nsent the export'])
  await assert.rejects(requests.close(id), (err: unknown) => err instanceof PrivacyRequestError && /already completed/.test(err.message))
  await assert.rejects(requests.close(randomUUID()), PrivacyRequestError)

  const { id: other } = await requests.record({ memberId: null, kind: 'objection' }, now)
  await requests.close(other, { refused: true, notes: 'could not confirm who was asking' }, days(5))
  assert.deepEqual([(await row(other)).status, (await row(other)).notes], ['refused', 'could not confirm who was asking'])
})

test('a deletion request closes by deleting the account, or by refusing one never acted on', async () => {
  const { id } = await requests.record({ memberId: ada, kind: 'deletion' }, now)
  await assert.rejects(requests.close(id), (err: unknown) => err instanceof PrivacyRequestError && /delete-account/.test(err.message))
  await db.update(privacyRequests).set({ status: 'in_progress' }).where(eq(privacyRequests.id, id))
  await assert.rejects(requests.close(id, { refused: true }), (err: unknown) => err instanceof PrivacyRequestError && /when the account is erased/.test(err.message))

  const { id: unconfirmed } = await requests.record({ memberId: ada, kind: 'deletion' }, now)
  await requests.close(unconfirmed, { refused: true, notes: 'no reply from the account address' }, days(30))
  assert.equal((await row(unconfirmed)).status, 'refused')
})
