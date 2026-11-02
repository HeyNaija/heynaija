import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { featureFlagChanges, featureFlagMembers, featureFlags, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { APP_ENVS } from '../env.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { FeatureFlags, FlagChangeError } from './feature-flags.js'
import { FLAGS, type FlagDefinition, type FlagKey, flagKeys, isFlagKey, resolveFlag } from './registry.js'

const ada = randomUUID() // site admin
const bayo = randomUUID() // ordinary member
const chi = randomUUID() // ordinary member

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
})
after(() => pool.end())

/**
 * Every flag whose feature is already in origin/main, which deploys to production on
 * every push, so it is ON in production by default: merging the flag system must not
 * change what production does. Evidence, checked against origin/main (cc38709):
 *   polls          posts.controller.ts  PUT posts/:id/poll/vote; composer.tsx poll builder
 *   replyControls  posts.controller.ts  PUT posts/:id/reply-audience; composer.tsx audience picker
 *   topicDiscovery topics.controller.ts GET v1/topics/trending; shell.tsx TrendingTopics
 *   onboarding     onboarding.controller.ts; (main)/page.tsx redirect to /welcome
 *   profilePins    posts.controller.ts  PUT posts/:id/pin
 *   communityPins  posts.controller.ts  PUT posts/:id/community-pin
 *   reposts        posts.controller.ts  PUT posts/:id/repost
 *   quotePosts     posts.service.ts     newPost `quote`
 *   linkPreviews   posts.controller.ts  links.request(linkUrl) on create
 * A flag for a feature that is NOT in main yet is added here as false. Changing a
 * value is a deliberate, visible diff.
 */
const LIVE_IN_MAIN: Record<FlagKey, boolean> = {
  polls: true,
  replyControls: true,
  topicDiscovery: true,
  onboarding: true,
  profilePins: true,
  communityPins: true,
  reposts: true,
  quotePosts: true,
  linkPreviews: true,
}

/** The real registry, except that `polls` is not launched in production: for tests of that case. */
const POLLS_DARK: Record<FlagKey, FlagDefinition> = {
  ...FLAGS,
  polls: { ...FLAGS.polls, defaults: { development: true, staging: true, production: false } },
}

test('production defaults: exactly the table of what is live in main, so merging changes nothing in production', () => {
  assert.deepEqual([...flagKeys].sort(), Object.keys(LIVE_IN_MAIN).sort(), 'a new flag needs a LIVE_IN_MAIN entry')
  for (const key of flagKeys) assert.equal(FLAGS[key].defaults.production, LIVE_IN_MAIN[key], key)
})

/** A clock the test moves by hand. */
const clock = (start = 1_000_000) => {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

test('registry: every flag is described, owned, and has a default for every environment; staging is all on', () => {
  assert.ok(flagKeys.length > 0)
  for (const key of flagKeys) {
    const flag = FLAGS[key]
    assert.match(key, /^[a-z][a-zA-Z0-9]*$/, key)
    assert.ok(flag.description.length > 10, `${key} description`)
    assert.ok(flag.owner.length > 0, `${key} owner`)
    for (const env of APP_ENVS) assert.equal(typeof flag.defaults[env], 'boolean', `${key} ${env}`)
    assert.equal(flag.defaults.staging, true, `${key}: staging defaults to on`)
    assert.equal(flag.defaults.development, true, `${key}: development follows staging`)
  }
})

test('registry: only known keys are keys', () => {
  assert.equal(isFlagKey('polls'), true)
  assert.equal(isFlagKey('nope'), false)
  assert.equal(isFlagKey('constructor'), false)
  assert.equal(isFlagKey('__proto__'), false)
})

test('resolution: override beats default; an allow-list beats both; viewers outside it get off', () => {
  const key: FlagKey = 'polls'
  const allow = new Set([bayo])
  for (const env of APP_ENVS) {
    const dflt: boolean = FLAGS[key].defaults[env]
    // No override at all, and an override row that says nothing.
    assert.equal(resolveFlag(key, env, undefined, bayo), dflt, `${env}: no row`)
    assert.equal(resolveFlag(key, env, { enabled: null, allow: new Set() }, bayo), dflt, `${env}: null`)
    // Forced on or off, for anyone, signed in or not.
    for (const viewer of [bayo, null, undefined]) {
      assert.equal(resolveFlag(key, env, { enabled: true, allow: new Set() }, viewer), true, `${env}: on`)
      assert.equal(resolveFlag(key, env, { enabled: false, allow: new Set() }, viewer), false, `${env}: off`)
    }
    // Allow-list: on for those members only, whatever `enabled` and the default say.
    for (const enabled of [null, true, false]) {
      assert.equal(resolveFlag(key, env, { enabled, allow }, bayo), true, `${env}/${enabled}: listed`)
      assert.equal(resolveFlag(key, env, { enabled, allow }, chi), false, `${env}/${enabled}: not listed`)
      assert.equal(resolveFlag(key, env, { enabled, allow }, null), false, `${env}/${enabled}: signed out`)
    }
  }
})

test('service: with no rows each flag follows its default for the environment', async () => {
  const staging = new FeatureFlags(db, 'staging')
  const production = new FeatureFlags(db, 'production')
  for (const key of flagKeys) {
    assert.equal(await staging.isEnabled(key), FLAGS[key].defaults.staging, key)
    assert.equal(await production.isEnabled(key), FLAGS[key].defaults.production, key)
  }
  assert.deepEqual(Object.keys(await production.all()).sort(), [...flagKeys].sort())
})

test('service: a database override changes the answer; clearing it restores the default', async () => {
  const flags = new FeatureFlags(db, 'production', { registry: POLLS_DARK })
  assert.equal(await flags.isEnabled('polls'), false)
  await flags.set(ada, 'polls', { enabled: true })
  assert.equal(await flags.isEnabled('polls'), true)
  assert.equal(await flags.isEnabled('polls', bayo), true)
  await flags.set(ada, 'polls', { enabled: false })
  assert.equal(await flags.isEnabled('polls'), false)
  await flags.set(ada, 'polls', { enabled: null })
  assert.equal(await flags.isEnabled('polls'), false, 'cleared: back to the default')
  // And a live feature can be switched off by an admin.
  const live = new FeatureFlags(db, 'production')
  assert.equal(await live.isEnabled('reposts'), true)
  await live.set(ada, 'reposts', { enabled: false })
  assert.equal(await live.isEnabled('reposts'), false)
})

test('service: an allow-list is on for those members only, in an environment where the default is on too', async () => {
  const flags = new FeatureFlags(db, 'staging')
  await flags.set(ada, 'polls', { enabled: null, handles: ['bayo'] })
  assert.equal(await flags.isEnabled('polls', bayo), true)
  assert.equal(await flags.isEnabled('polls', chi), false)
  assert.equal(await flags.isEnabled('polls', null), false)
  assert.equal(await flags.isEnabled('polls'), false)
  assert.deepEqual((await flags.all(bayo)).polls, true)
  assert.deepEqual((await flags.all(chi)).polls, false)
  // Emptying the list returns to the default.
  await flags.set(ada, 'polls', { enabled: null, handles: [] })
  assert.equal(await flags.isEnabled('polls', chi), true)
})

test('service: a key the code does not know is ignored, whatever the database says', async () => {
  await db.insert(featureFlags).values({ key: 'madeUpFlag', enabled: true })
  await db.insert(featureFlags).values({ key: '__proto__', enabled: true })
  const flags = new FeatureFlags(db, 'production')
  const all = await flags.all()
  assert.equal('madeUpFlag' in all, false)
  assert.equal(await flags.isEnabled('madeUpFlag' as FlagKey), false)
  assert.equal(await flags.isEnabled('polls'), true)
  await assert.rejects(() => flags.set(ada, 'madeUpFlag', { enabled: true }), (e: unknown) => e instanceof FlagChangeError && e.reason === 'unknown_flag')
})

test('cache: a change made behind the service shows once the TTL has passed; a change through it shows at once', async () => {
  const time = clock()
  const flags = new FeatureFlags(db, 'production', { ttlMs: 5_000, now: time.now })
  assert.equal(await flags.isEnabled('polls'), true)
  // Another process (or an operator with psql) changes the table.
  await db.insert(featureFlags).values({ key: 'polls', enabled: false })
  time.advance(4_999)
  assert.equal(await flags.isEnabled('polls'), true, 'still cached')
  time.advance(1)
  assert.equal(await flags.isEnabled('polls'), false, 'read again after the TTL')
  // A write through this service does not wait.
  await flags.set(ada, 'polls', { enabled: true })
  assert.equal(await flags.isEnabled('polls'), true)
})

test('cache: one read serves concurrent callers', async () => {
  let reads = 0
  const flags = new FeatureFlags(db, 'production', {
    load: async () => {
      reads++
      await new Promise((resolve) => setTimeout(resolve, 10))
      return new Map()
    },
  })
  await Promise.all([flags.isEnabled('polls'), flags.isEnabled('polls'), flags.all(), flags.isEnabled('replyControls')])
  assert.equal(reads, 1)
})

test('cache: a read that began before a write does not put its stale answer back', async () => {
  const time = clock()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  let first = true
  const flags = new FeatureFlags(db, 'production', {
    now: time.now,
    load: async () => {
      if (first) {
        first = false
        await gate
        return new Map() // what the table held before the write
      }
      return new Map([['polls', { enabled: true, allow: new Set<string>() }]])
    },
  })
  const slow = flags.isEnabled('polls')
  flags.invalidate()
  release()
  await slow
  assert.equal(await flags.isEnabled('polls'), true)
})

test('fail closed: when the database cannot be read the last good answer is kept, else the production default', async () => {
  const time = clock()
  let broken = false
  const errors: unknown[] = []
  const flags = new FeatureFlags(db, 'staging', {
    ttlMs: 5_000,
    now: time.now,
    registry: POLLS_DARK,
    onError: (e) => errors.push(e),
    load: async () => {
      if (broken) throw new Error('database is down')
      return new Map([['replyControls', { enabled: false, allow: new Set<string>() }]])
    },
  })
  assert.equal(await flags.isEnabled('replyControls'), false)
  assert.equal(await flags.isEnabled('polls'), true, 'staging default while the read works')
  broken = true
  time.advance(6_000)
  // The last good snapshot still answers, including its override.
  assert.equal(await flags.isEnabled('replyControls'), false)
  assert.equal(await flags.isEnabled('polls'), true)
  assert.equal(errors.length, 1)
  // It is not retried on every call.
  await flags.isEnabled('polls')
  assert.equal(errors.length, 1)

  // Never read at all: the PRODUCTION default, not staging's.
  const fresh = new FeatureFlags(db, 'staging', {
    registry: POLLS_DARK,
    onError: () => {},
    load: async () => {
      throw new Error('database is down')
    },
  })
  assert.equal(await fresh.isEnabled('polls'), false, 'polls is off in production, on in staging')
  for (const key of flagKeys) assert.equal(await fresh.isEnabled(key), POLLS_DARK[key].defaults.production, key)
  // And it recovers by itself.
  const later = clock()
  let up = false
  const recovering = new FeatureFlags(db, 'staging', {
    registry: POLLS_DARK,
    ttlMs: 5_000,
    now: later.now,
    onError: () => {},
    load: async () => {
      if (!up) throw new Error('down')
      return new Map()
    },
  })
  assert.equal(await recovering.isEnabled('polls'), false)
  up = true
  later.advance(5_000)
  assert.equal(await recovering.isEnabled('polls'), true)
})

test('audit: every change records who, the override before and the override after, naming members by ID', async () => {
  const flags = new FeatureFlags(db, 'production')
  await flags.set(ada, 'polls', { enabled: true })
  await flags.set(ada, 'polls', { enabled: null, handles: ['bayo', 'chi'] })
  await flags.set(ada, 'polls', { enabled: false })
  const rows = (await db.select().from(featureFlagChanges).orderBy(featureFlagChanges.createdAt)).filter((r) => r.flagKey === 'polls')
  const listed = [bayo, chi].sort()
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0]!.before, { enabled: null, memberIds: [] })
  assert.deepEqual(rows[0]!.after, { enabled: true, memberIds: [] })
  assert.deepEqual(rows[1]!.before, { enabled: true, memberIds: [] })
  assert.deepEqual(rows[1]!.after, { enabled: null, memberIds: listed })
  assert.deepEqual(rows[2]!.before, { enabled: null, memberIds: listed })
  assert.deepEqual(rows[2]!.after, { enabled: false, memberIds: [] })
  for (const row of rows) assert.equal(row.actorId, ada)
  const [row] = await db.select().from(featureFlags).where(eq(featureFlags.key, 'polls'))
  assert.equal(row?.updatedBy, ada)
  assert.equal((await db.select().from(featureFlagMembers)).length, 0)
})

test('audit: the log shows each member under the handle they have now', async () => {
  const flags = new FeatureFlags(db, 'production')
  await flags.set(ada, 'polls', { enabled: null, handles: ['bayo'] })
  await db.update(members).set({ handle: 'bayo_new' }).where(eq(members.id, bayo))
  await db.update(members).set({ handle: 'ada_new' }).where(eq(members.id, ada))
  const [change] = (await flags.describe()).changes
  assert.equal(change?.actorHandle, 'ada_new')
  assert.deepEqual(change?.after, { enabled: null, handles: ['bayo_new'] })
})

test('writes: an erased account cannot be put on an allow-list', async () => {
  const flags = new FeatureFlags(db, 'production')
  await db.update(members).set({ handle: 'deleted-0000beef', deletedAt: new Date() }).where(eq(members.id, chi))
  await assert.rejects(
    () => flags.set(ada, 'polls', { enabled: null, handles: ['deleted-0000beef'] }),
    (e: unknown) => e instanceof FlagChangeError && e.reason === 'unknown_handles',
  )
  assert.equal((await db.select().from(featureFlagChanges)).length, 0)
})

test('writes: unknown flags and handles, and an on/off together with an allow-list, are refused and change nothing', async () => {
  const flags = new FeatureFlags(db, 'production')
  await assert.rejects(() => flags.set(ada, 'nope', { enabled: true }), (e: unknown) => e instanceof FlagChangeError && e.reason === 'unknown_flag')
  await assert.rejects(
    () => flags.set(ada, 'polls', { enabled: null, handles: ['bayo', 'ghost'] }),
    (e: unknown) => e instanceof FlagChangeError && e.reason === 'unknown_handles' && e.message.includes('ghost'),
  )
  await assert.rejects(
    () => flags.set(ada, 'polls', { enabled: true, handles: ['bayo'] }),
    (e: unknown) => e instanceof FlagChangeError && e.reason === 'conflict',
  )
  assert.equal((await db.select().from(featureFlags)).length, 0)
  assert.equal((await db.select().from(featureFlagChanges)).length, 0)
})

test('admin list: shows each flag with its default, override and allow-list, and the recent changes', async () => {
  const flags = new FeatureFlags(db, 'production')
  await flags.set(ada, 'polls', { enabled: null, handles: ['bayo'] })
  const view = await flags.describe()
  assert.equal(view.env, 'production')
  assert.deepEqual(view.flags.map((f) => f.key).sort(), [...flagKeys].sort())
  const polls = view.flags.find((f) => f.key === 'polls')!
  assert.equal(polls.default, FLAGS.polls.defaults.production)
  assert.deepEqual(polls.defaults, FLAGS.polls.defaults)
  assert.deepEqual(polls.override, { enabled: null, handles: ['bayo'] })
  assert.equal(polls.updatedBy, 'ada')
  assert.equal(view.flags.find((f) => f.key === 'replyControls')!.override, null)
  assert.equal(view.changes[0]?.flagKey, 'polls')
  assert.equal(view.changes[0]?.actorHandle, 'ada')
})
