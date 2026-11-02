import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members } from '@heynaija/db'
import { type ExecutionContext, HttpException } from '@nestjs/common'
import { AuthController } from '../auth/auth.controller.js'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { InvitesService } from '../invites/invites.service.js'
import { OnboardingController } from '../onboarding/onboarding.controller.js'
import { PostsController } from '../posts/posts.controller.js'
import { PostsService } from '../posts/posts.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { TopicsController } from '../topics/topics.controller.js'
import { FeatureFlags } from './feature-flags.js'
import { FeatureGuard, featureOf } from './feature.guard.js'
import { FLAGS, type FlagKey, flagKeys } from './registry.js'

const ada = randomUUID() // site admin, sets flags
const bayo = randomUUID()

const production = new FeatureFlags(db, 'production')
const development = new FeatureFlags(db, 'development')

const auth = (flags: FeatureFlags) =>
  new AuthController(
    {} as never,
    { scope: async () => ({ siteWide: false, communityIds: [] }) } as never,
    { unreadCount: async () => 0 } as never,
    {} as never,
    {} as never,
    db,
    {} as never,
    {} as never,
    {} as never,
    flags,
  )
const as = (id: string, handle: string) => ({ member: { id, handle } }) as AuthedRequest

const posts = (flags: FeatureFlags, requested: string[] = []) =>
  new PostsController(
    new PostsService(db),
    {} as never,
    { request: async (url: string) => void requested.push(url) } as never,
    new MemoryRateLimiter(),
    flags,
  )

const status = async (run: () => Promise<unknown>) => {
  try {
    await run()
    return 200
  } catch (err) {
    assert.ok(err instanceof HttpException, String(err))
    return err.getStatus()
  }
}

before(migrate)
beforeEach(async () => {
  await reset()
  production.invalidate()
  development.invalidate()
  await db.insert(members).values([
    { id: ada, handle: 'ada', onboardedAt: new Date() },
    { id: bayo, handle: 'bayo' },
  ])
})
after(() => pool.end())

test('/v1/me: `features` has one boolean per registry flag, and the rest of the shape is unchanged', async () => {
  const me = await auth(development).me(as(ada, 'ada'))
  // The database-backed flags, plus `gists`, which is still switched by env (docs/feature-flags.md).
  assert.deepEqual(Object.keys(me.features).sort(), [...flagKeys, 'gists'].sort())
  for (const key of flagKeys) assert.equal(me.features[key], FLAGS[key].defaults.development, key)
  for (const field of ['id', 'handle', 'avatar', 'displayName', 'bio', 'unreadNotifications', 'moderates', 'onboarded']) {
    assert.ok(field in me, field)
  }
  assert.equal(me.onboarded, true)
})

test('/v1/me: features follow the environment and the viewer', async () => {
  const live = await auth(production).me(as(bayo, 'bayo'))
  assert.equal(live.features.polls, true, 'live in main, so on in production')
  await production.set(ada, 'polls', { enabled: null, handles: ['bayo'] })
  assert.equal((await auth(production).me(as(bayo, 'bayo'))).features.polls, true)
  assert.equal((await auth(production).me(as(ada, 'ada'))).features.polls, false)
  await production.set(ada, 'reposts', { enabled: false })
  assert.equal((await auth(production).me(as(bayo, 'bayo'))).features.reposts, false)
})

test('/v1/me: with the welcome flow off nobody is sent to it', async () => {
  assert.equal((await auth(production).me(as(bayo, 'bayo'))).onboarded, false, 'on by default, bayo has not done it')
  assert.equal((await auth(development).me(as(bayo, 'bayo'))).onboarded, false)
  await production.set(ada, 'onboarding', { enabled: false })
  assert.equal((await auth(production).me(as(bayo, 'bayo'))).onboarded, true)
})

test('creating a post: a poll, a reply limit or a quote is refused while its flag is off, and works once on', async () => {
  const controller = posts(production)
  for (const key of ['polls', 'replyControls'] as const) await production.set(ada, key, { enabled: false })
  const poll = { text: 'Which?', poll: { options: ['a', 'b'], multiple: false, expiresIn: '7_days' } }
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), poll)), 400)
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), { text: 'hi', replyAudience: 'following' })), 400)
  const original = await controller.create(as(bayo, 'bayo'), { text: 'plain post' })
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), { text: 'q', quote: original.id })), 200)
  await production.set(ada, 'quotePosts', { enabled: false })
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), { text: 'q2', quote: original.id })), 400)
  // A plain post is never gated.
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), { text: 'still fine' })), 200)

  await production.set(ada, 'polls', { enabled: true })
  await production.set(ada, 'replyControls', { enabled: true })
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), poll)), 200)
  assert.equal(await status(() => controller.create(as(bayo, 'bayo'), { text: 'hi2', replyAudience: 'following' })), 200)
})

test('creating a post: the linked page is only asked for while link previews are on', async () => {
  const asked: string[] = []
  const controller = posts(production, asked)
  await controller.create(as(bayo, 'bayo'), { text: 'see https://example.com/a' })
  assert.equal(asked.length, 1)
  await production.set(ada, 'linkPreviews', { enabled: false })
  await controller.create(as(bayo, 'bayo'), { text: 'see https://example.com/b' })
  assert.equal(asked.length, 1)
})

test('routes: each gated route carries its flag and the guard', () => {
  const gated: [object, string, FlagKey][] = [
    [PostsController.prototype, 'votePoll', 'polls'],
    [PostsController.prototype, 'setReplyAudience', 'replyControls'],
    [PostsController.prototype, 'repost', 'reposts'],
    [PostsController.prototype, 'pin', 'profilePins'],
    [PostsController.prototype, 'pinInCommunity', 'communityPins'],
    [TopicsController.prototype, 'trending', 'topicDiscovery'],
    [OnboardingController.prototype, 'suggestions', 'onboarding'],
    [OnboardingController.prototype, 'complete', 'onboarding'],
    [OnboardingController.prototype, 'skip', 'onboarding'],
  ]
  for (const [proto, method, flag] of gated) {
    const handler = (proto as Record<string, unknown>)[method] as object
    assert.equal(featureOf(handler, proto.constructor), flag, `${proto.constructor.name}.${method}`)
    const guards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[]
    assert.ok(guards.includes(FeatureGuard), `${proto.constructor.name}.${method} uses FeatureGuard`)
  }
})

test('onboarding: a member who joins while the flow is off is not sent through it when it is switched on; one who joins after is', async () => {
  const invites = new InvitesService(db)
  const join = async (handle: string) => {
    const identity = { id: randomUUID(), handle }
    assert.equal(await invites.redeem(await invites.create(), identity.id), true)
    const guard = new SessionGuard({ identityForRequest: async () => identity }, { WEB_PUBLIC_URL: 'http://127.0.0.1:3000' }, db, invites, production)
    const req = { method: 'GET', headers: {}, cookies: { hn_session: 'good' } }
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext), true)
    return identity
  }
  await production.set(ada, 'onboarding', { enabled: false })
  const early = await join('early')
  assert.equal((await auth(production).me(as(early.id, 'early'))).onboarded, true)

  await production.set(ada, 'onboarding', { enabled: true })
  const late = await join('late')
  assert.equal((await auth(production).me(as(early.id, 'early'))).onboarded, true, 'joined while off: still not sent to /welcome')
  assert.equal((await auth(production).me(as(late.id, 'late'))).onboarded, false, 'joined after: sent to /welcome')

  // Switched off and on again: whoever joined in between is not sent either.
  await production.set(ada, 'onboarding', { enabled: false })
  const between = await join('between')
  await production.set(ada, 'onboarding', { enabled: true })
  assert.equal((await auth(production).me(as(between.id, 'between'))).onboarded, true)
})
