import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members } from '@heynaija/db'
import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { InvitesService } from '../invites/invites.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AuthService, type MemberIdentity as Identity } from './auth.service.js'
import { KratosAdmin } from './kratos-admin.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { type AuthedRequest, LAST_SEEN_EVERY_MS, SessionGuard, SuspendedAllowedGuard } from './session.guard.js'

const WEB = 'http://127.0.0.1:3000'
const invites = new InvitesService(db)

// Through AuthService and the Kratos adapter, with Kratos stubbed: "good" is a
// valid session cookie for `identity`.
const authFor = (identity: Identity) => new AuthService(new KratosSessionProvider({
  identityForSession: async (cookie) => (cookie === 'good' ? identity : null),
  forgetSession: async () => {},
  emailForSession: async () => null,
  authenticatedAtForSession: async () => null,
}, new KratosAdmin({ KRATOS_ADMIN_URL: 'http://kratos-admin.test' })))
const guardFor = (identity: Identity) =>
  new SessionGuard(
    authFor(identity),
    { WEB_PUBLIC_URL: WEB },
    db,
    invites,
  )

const request = (over: { method?: string; origin?: string; cookie?: string } = {}) => {
  const req = {
    method: over.method ?? 'GET',
    headers: {
      ...(over.origin ? { origin: over.origin } : {}),
      ...(over.cookie ? { cookie: `hn_session=${over.cookie}` } : {}),
    },
  } as unknown as AuthedRequest
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
  return { req, context }
}

const invited = async (handle: string): Promise<Identity> => {
  const identity = { id: randomUUID(), handle }
  assert.equal(await invites.redeem(await invites.create(), identity.id), true)
  return identity
}

before(migrate)
beforeEach(reset)
after(() => pool.end())

test('no cookie, or a cookie Kratos does not recognise, is 401', async () => {
  const guard = guardFor(await invited('ada'))
  await assert.rejects(guard.canActivate(request().context), UnauthorizedException)
  await assert.rejects(guard.canActivate(request({ cookie: 'stale' }).context), UnauthorizedException)
})

test('first sight of an invited identity creates the member', async () => {
  const identity = await invited('ada')
  const { req, context } = request({ cookie: 'good' })
  assert.equal(await guardFor(identity).canActivate(context), true)
  assert.deepEqual(req.member, identity)
  const [row] = await db.select().from(members)
  assert.equal(row!.id, identity.id)
  assert.equal(row!.handle, 'ada')
})

test('a Kratos account that never redeemed an invite is not a member', async () => {
  const guard = guardFor({ id: randomUUID(), handle: 'gatecrasher' })
  await assert.rejects(guard.canActivate(request({ cookie: 'good' }).context), ForbiddenException)
  assert.equal((await db.select().from(members)).length, 0)
})

test('a changed handle is picked up on the next request', async () => {
  const identity = await invited('ada')
  await guardFor(identity).canActivate(request({ cookie: 'good' }).context)
  await guardFor({ ...identity, handle: 'ada_o' }).canActivate(request({ cookie: 'good' }).context)
  assert.equal((await db.select().from(members))[0]!.handle, 'ada_o')
})

test('last_seen_at is written at most once every few minutes', async () => {
  const identity = await invited('ada')
  const guard = guardFor(identity)
  const lastSeen = async () => (await db.select().from(members))[0]!.lastSeenAt!.getTime()
  const setLastSeen = (msAgo: number) =>
    db.update(members).set({ lastSeenAt: new Date(Date.now() - msAgo) }).where(eq(members.id, identity.id))

  await guard.canActivate(request({ cookie: 'good' }).context)
  // Seen a minute ago: further requests leave it alone.
  await setLastSeen(60_000)
  const before = await lastSeen()
  for (let i = 0; i < 3; i++) await guard.canActivate(request({ cookie: 'good' }).context)
  assert.equal(await lastSeen(), before)

  // Seen longer ago than the interval: the next request refreshes it.
  await setLastSeen(LAST_SEEN_EVERY_MS + 1000)
  await guard.canActivate(request({ cookie: 'good' }).context)
  assert.ok(Date.now() - (await lastSeen()) < 5000)
})

test('a suspension applies to the very next request, even right after one that passed', async () => {
  const identity = await invited('ada')
  const guard = guardFor(identity)
  await guard.canActivate(request({ cookie: 'good' }).context)
  await guard.canActivate(request({ cookie: 'good' }).context)
  await db.update(members).set({ active: false }).where(eq(members.id, identity.id))
  await assert.rejects(guard.canActivate(request({ cookie: 'good' }).context), ForbiddenException)
})

test('a suspended member is refused', async () => {
  const identity = await invited('ada')
  const guard = guardFor(identity)
  await guard.canActivate(request({ cookie: 'good' }).context)
  await db.update(members).set({ active: false }).where(eq(members.id, identity.id))
  await assert.rejects(guard.canActivate(request({ cookie: 'good' }).context), ForbiddenException)
})

test('cross-origin writes are refused even with a valid session; reads and same-origin writes pass', async () => {
  const guard = guardFor(await invited('ada'))
  const evil = { cookie: 'good', origin: 'https://evil.example' }
  await assert.rejects(guard.canActivate(request({ ...evil, method: 'POST' }).context), ForbiddenException)
  await assert.rejects(guard.canActivate(request({ ...evil, method: 'DELETE' }).context), ForbiddenException)
  assert.equal(await guard.canActivate(request({ ...evil, method: 'GET' }).context), true)
  assert.equal(await guard.canActivate(request({ cookie: 'good', origin: WEB, method: 'POST' }).context), true)
  // Server-side callers (the web app's server actions) send no Origin header.
  assert.equal(await guard.canActivate(request({ cookie: 'good', method: 'POST' }).context), true)
})

test('the appeal guard lets a suspended member through, but still not a stranger', async () => {
  const identity = await invited('ada')
  await guardFor(identity).canActivate(request({ cookie: 'good' }).context)
  await db.update(members).set({ active: false }).where(eq(members.id, identity.id))

  const appealGuard = new SuspendedAllowedGuard(authFor(identity), { WEB_PUBLIC_URL: WEB }, db, invites)
  const { req, context } = request({ cookie: 'good', method: 'POST' })
  assert.equal(await appealGuard.canActivate(context), true)
  assert.equal(req.member.id, identity.id)

  await assert.rejects(appealGuard.canActivate(request({ method: 'POST' }).context), UnauthorizedException)
  await assert.rejects(
    appealGuard.canActivate(request({ cookie: 'good', method: 'POST', origin: 'https://evil.example' }).context),
    ForbiddenException,
  )
})

test('while a deletion waits, the member row keeps the handle the erase will hold', async () => {
  const identity = await invited('ada')
  await guardFor(identity).canActivate(request({ cookie: 'good' }).context)
  const asked = new Date(Date.now() - LAST_SEEN_EVERY_MS * 2)
  await db.update(members).set({ active: false, deletionRequestedAt: asked, lastSeenAt: asked }).where(eq(members.id, identity.id))

  // A session cached from before the request, or renamed in Kratos meanwhile.
  const pending = new SuspendedAllowedGuard(authFor({ ...identity, handle: 'ada_new' }), { WEB_PUBLIC_URL: WEB }, db, invites)
  assert.equal(await pending.canActivate(request({ cookie: 'good' }).context), true)
  const [row] = await db.select().from(members).where(eq(members.id, identity.id))
  assert.deepEqual([row!.handle, row!.lastSeenAt], ['ada', asked])
})

test('an erased account is signed out, even to the appeal guard, and its tombstone is never rewritten', async () => {
  const identity = await invited('ada')
  await guardFor(identity).canActivate(request({ cookie: 'good' }).context)
  await db
    .update(members)
    .set({ active: false, handle: 'deleted-0a1b2c3d', deletionRequestedAt: new Date(), deletedAt: new Date() })
    .where(eq(members.id, identity.id))

  // Kratos may still vouch for the session for up to WHOAMI_CACHE_TTL_S after deleting the identity.
  for (const guard of [guardFor(identity), new SuspendedAllowedGuard(authFor(identity), { WEB_PUBLIC_URL: WEB }, db, invites)]) {
    await assert.rejects(guard.canActivate(request({ cookie: 'good' }).context), UnauthorizedException)
  }
  const [row] = await db.select().from(members).where(eq(members.id, identity.id))
  assert.equal(row!.handle, 'deleted-0a1b2c3d')
})
