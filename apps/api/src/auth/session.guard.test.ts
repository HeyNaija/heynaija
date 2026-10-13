import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members } from '@heynaija/db'
import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { InvitesService } from '../invites/invites.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import type { Identity } from './kratos.service.js'
import { type AuthedRequest, SessionGuard } from './session.guard.js'

const WEB = 'http://127.0.0.1:3000'
const invites = new InvitesService(db)

// Kratos is stubbed: "good" is a valid session cookie for `identity`.
const guardFor = (identity: Identity) =>
  new SessionGuard(
    { identityForSession: async (cookie) => (cookie === 'good' ? identity : null) },
    { WEB_PUBLIC_URL: WEB },
    db,
    invites,
  )

const request = (over: { method?: string; origin?: string; cookie?: string } = {}) => {
  const req = {
    method: over.method ?? 'GET',
    headers: over.origin ? { origin: over.origin } : {},
    cookies: over.cookie ? { hn_session: over.cookie } : {},
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
