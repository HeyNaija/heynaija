import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, beforeEach, mock, test } from 'node:test'
import { members } from '@heynaija/db'
import { BadRequestException, ConflictException, ForbiddenException, HttpException, ServiceUnavailableException } from '@nestjs/common'
import { GUARDS_METADATA, HEADERS_METADATA } from '@nestjs/common/constants.js'
import { eq } from 'drizzle-orm'
import { AuthService } from '../auth/auth.service.js'
import { KratosAdmin } from '../auth/kratos-admin.js'
import { KratosSessionProvider } from '../auth/kratos-session.provider.js'
import { KratosService } from '../auth/kratos.service.js'
import { type AuthedRequest, SuspendedAllowedGuard } from '../auth/session.guard.js'
import { MembersService } from '../members/members.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AccountController, REAUTH_WINDOW_MS } from './account.controller.js'
import { AccountDeletionService } from './account-deletion.service.js'

// The handlers with the real deletion service and database, and AuthService
// through the Kratos adapter with fetch standing in for Kratos. "good" is a live
// session that signed in `signedInMsAgo` ago.
const DAY = 24 * 60 * 60 * 1000
const ada = { id: randomUUID(), handle: 'ada' }
const bola = { id: randomUUID(), handle: 'bola' } // suspended
const sam = { id: randomUUID(), handle: 'sam' } // site moderator

let signedInMsAgo: number
let kratosDown: boolean
let controller: AccountController

const request = (member: { id: string; handle: string }) => ({ headers: { cookie: 'hn_session=good' }, member }) as AuthedRequest
const member = async (id: string) => (await db.select().from(members).where(eq(members.id, id)))[0]!
const code = (err: unknown) => (err instanceof HttpException ? (err.getResponse() as { code?: string }).code : undefined)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada.id, handle: 'ada' },
    { id: bola.id, handle: 'bola', active: false, status: 'suspended' },
    { id: sam.id, handle: 'sam', role: 'moderator' },
  ])
  signedInMsAgo = 60_000
  kratosDown = false
  mock.method(globalThis, 'fetch', async (url: string) => {
    if (kratosDown) return new Response(null, { status: 503 })
    // The admin API: ending sessions when a deletion is asked for.
    if (String(url).startsWith('http://kratos-admin.test')) return new Response(null, { status: 204 })
    return Response.json({
      active: true,
      authenticated_at: new Date(Date.now() - signedInMsAgo).toISOString(),
      identity: { id: ada.id, traits: { handle: 'ada' } },
    })
  })
  const cache = { get: async () => null, set: async () => {}, delete: async () => {} }
  const kratos = new KratosService({ KRATOS_PUBLIC_URL: 'http://kratos.test', WHOAMI_CACHE_TTL_S: 30 }, cache)
  const auth = new AuthService(new KratosSessionProvider(kratos, new KratosAdmin({ KRATOS_ADMIN_URL: 'http://kratos-admin.test' })))
  const deletion = new AccountDeletionService(
    db,
    { ACCOUNT_DELETION_GRACE_DAYS: 14, PRIVACY_REQUEST_DUE_DAYS: 30 },
    auth,
    { addressFor: async () => null },
    { eraseFilesOf: async () => {} },
    new MembersService(db),
    { endHostedBy: async () => {} },
  )
  controller = new AccountController({ ACCOUNT_DELETION_GRACE_DAYS: 14 }, deletion, auth, new MemoryRateLimiter())
})
afterEach(() => mock.restoreAll())
after(() => pool.end())

test('typing the handle soon after signing in schedules the deletion; asking again changes nothing', async () => {
  assert.deepEqual(await controller.state(request(ada)), { state: 'none', graceDays: 14 })
  const before = Date.now()
  const asked = await controller.request(request(ada), { confirmHandle: ' @Ada ' })
  assert.equal(asked.state, 'scheduled')
  const scheduledFor = new Date((asked as { scheduledFor: string }).scheduledFor).getTime()
  assert.ok(scheduledFor >= before + 14 * DAY && scheduledFor <= Date.now() + 14 * DAY)
  assert.equal((await member(ada.id)).active, false)

  assert.deepEqual(await controller.state(request(ada)), asked)
  assert.deepEqual(await controller.request(request(ada), { confirmHandle: 'ada' }), asked, 'already scheduled')
})

test('a wrong handle is refused and schedules nothing', async () => {
  for (const confirmHandle of ['bola', 'ad', '']) {
    await assert.rejects(controller.request(request(ada), { confirmHandle }), (err) => err instanceof BadRequestException && code(err) === 'handle_mismatch')
  }
  await assert.rejects(controller.request(request(ada), {}), BadRequestException)
  assert.deepEqual(await controller.state(request(ada)), { state: 'none', graceDays: 14 })
})

test('a sign-in older than 15 minutes, or a session Kratos has ended, needs a fresh sign-in', async () => {
  signedInMsAgo = REAUTH_WINDOW_MS + 60_000
  const stale = (err: unknown) => err instanceof ForbiddenException && code(err) === 'reauth_required'
  await assert.rejects(controller.request(request(ada), { confirmHandle: 'ada' }), stale)
  mock.restoreAll()
  mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }))
  await assert.rejects(controller.request(request(ada), { confirmHandle: 'ada' }), stale)
  assert.deepEqual(await controller.state(request(ada)), { state: 'none', graceDays: 14 })
})

test('if Kratos cannot say when they signed in, it is a 503, not a deletion', async () => {
  kratosDown = true
  await assert.rejects(controller.request(request(ada), { confirmHandle: 'ada' }), ServiceUnavailableException)
  assert.equal((await member(ada.id)).deletionRequestedAt, null)
})

test('asking and cancelling share a budget of five an hour', async () => {
  for (let i = 0; i < 5; i++) await assert.rejects(controller.request(request(ada), { confirmHandle: 'nope' }), BadRequestException)
  await assert.rejects(controller.request(request(ada), { confirmHandle: 'ada' }), (err) => err instanceof HttpException && err.getStatus() === 429)
  await assert.rejects(controller.cancel(request(ada)), (err) => err instanceof HttpException && err.getStatus() === 429)
  await controller.request(request(bola), { confirmHandle: 'bola' })
})

test('cancelling brings the member back; with nothing to cancel it is fine; once due it is too late', async () => {
  await controller.request(request(ada), { confirmHandle: 'ada' })
  await controller.cancel(request(ada))
  assert.deepEqual(await controller.state(request(ada)), { state: 'none', graceDays: 14 })
  assert.equal((await member(ada.id)).active, true)
  await controller.cancel(request(ada))

  await controller.request(request(ada), { confirmHandle: 'ada' })
  await db.update(members).set({ deletionScheduledFor: new Date(Date.now() - 1000) }).where(eq(members.id, ada.id))
  await assert.rejects(controller.cancel(request(ada)), (err) => err instanceof ConflictException && code(err) === 'too_late')
})

test('a suspended member can ask for deletion, and cancelling leaves them suspended', async () => {
  await controller.request(request(bola), { confirmHandle: 'bola' })
  assert.equal((await controller.state(request(bola))).state, 'scheduled')
  await controller.cancel(request(bola))
  const row = await member(bola.id)
  assert.deepEqual([row.active, row.status, row.deletionRequestedAt], [false, 'suspended', null])
})

test('a site moderator is told to be demoted first', async () => {
  await assert.rejects(controller.request(request(sam), { confirmHandle: 'sam' }), (err) => err instanceof ForbiddenException && code(err) === 'site_moderator')
  assert.equal((await member(sam.id)).active, true)
})

test('every endpoint lets suspended and pending members in, and none is cached', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, AccountController), [SuspendedAllowedGuard])
  for (const handler of [AccountController.prototype.state, AccountController.prototype.request, AccountController.prototype.cancel]) {
    assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, handler), [{ name: 'cache-control', value: 'no-store' }], handler.name)
  }
})
