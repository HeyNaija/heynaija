import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { HttpException } from '@nestjs/common'
import { Redis } from 'ioredis'
import { LIMITS, MemoryRateLimiter, rateLimitKey, RedisRateLimiter, visitor } from './rate-limit.js'

const is429 = (err: unknown) => err instanceof HttpException && err.getStatus() === 429

test('allows up to the limit, then refuses until the window passes', () => {
  const limiter = new MemoryRateLimiter()
  const perMinute = LIMITS.post[0]!.max
  for (let i = 0; i < perMinute; i++) limiter.check('post', 'ada', 1000)
  assert.throws(() => limiter.check('post', 'ada', 1000), is429)
  assert.throws(() => limiter.check('post', 'ada', 59_999), is429)
  limiter.check('post', 'ada', 61_001)
})

test('each member and each kind of action has its own budget', () => {
  const limiter = new MemoryRateLimiter()
  for (let i = 0; i < LIMITS.post[0]!.max; i++) limiter.check('post', 'ada', 0)
  assert.throws(() => limiter.check('post', 'ada', 0), is429)
  limiter.check('post', 'bayo', 0)
  limiter.check('action', 'ada', 0)
})

test('the hourly limit holds even when the per-minute one keeps resetting', () => {
  const limiter = new MemoryRateLimiter()
  const [perMinute, perHour] = LIMITS.post
  let now = 0
  let sent = 0
  for (; sent < perHour!.max; sent++) {
    if (sent > 0 && sent % perMinute!.max === 0) now += perMinute!.windowMs + 1
    limiter.check('post', 'ada', now)
  }
  now += perMinute!.windowMs + 1
  assert.throws(() => limiter.check('post', 'ada', now), is429)
  limiter.check('post', 'ada', perHour!.windowMs + 1)
})

test('a refused request does not use up budget in the other windows', () => {
  const limiter = new MemoryRateLimiter()
  const perMinute = LIMITS.post[0]!.max
  for (let i = 0; i < perMinute; i++) limiter.check('post', 'ada', 0)
  for (let i = 0; i < 500; i++) assert.throws(() => limiter.check('post', 'ada', 0), is429)
  // Had those 500 refusals counted toward the hour, this would now be refused too.
  limiter.check('post', 'ada', 60_001)
})

test('signed-out callers are counted by address, IPv6 by its /64', () => {
  const from = (ip?: string | string[]) => visitor({ headers: ip === undefined ? {} : { 'x-real-ip': ip } })
  assert.equal(from('102.89.34.7'), 'ip:102.89.34.7')
  assert.equal(from(['102.89.34.7']), 'ip:102.89.34.7')
  assert.equal(from('::ffff:102.89.34.7'), 'ip:102.89.34.7')
  assert.equal(from('2c0f:f5c0:440:12:a1b2::9'), 'ip6:2c0f:f5c0:440:12')
  assert.equal(from('2C0F:F5C0:0440:0012::1'), 'ip6:2c0f:f5c0:440:12')
  assert.equal(from('2001:db8::1'), 'ip6:2001:db8:0:0')
  // No address, or not an address: everyone signed out shares one budget.
  assert.equal(from(), 'anonymous')
  assert.equal(from(''), 'anonymous')
  assert.equal(from('not-an-address'), 'anonymous')
})

// Against a real Redis when one is configured (the dev stack has one; so does CI).
const redisUrl = process.env.REDIS_URL
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ioredis connects in the background, counting in memory until then: wait for a hit to land in Redis. */
async function untilConnected(limiter: RedisRateLimiter, redis: Redis) {
  const who = `test-${randomUUID()}`
  const key = rateLimitKey('search', LIMITS.search[0]!.windowMs, who)
  for (let i = 0; i < 50 && !(await redis.exists(key)); i++) {
    await limiter.hit('search', who)
    await sleep(20)
  }
  assert.equal(await redis.exists(key), 1, 'the limiter never reached Redis')
  await redis.del(key)
}

test('API processes share their counts in Redis; refusals count toward nothing', { skip: !redisUrl }, async () => {
  const redis = new Redis(redisUrl!)
  const a = new RedisRateLimiter({ REDIS_URL: redisUrl! })
  const b = new RedisRateLimiter({ REDIS_URL: redisUrl! })
  const who = `test-${randomUUID()}`
  const [perMinute, perHour] = LIMITS.post
  const minuteKey = rateLimitKey('post', perMinute!.windowMs, who)
  const hourKey = rateLimitKey('post', perHour!.windowMs, who)
  try {
    await untilConnected(a, redis)
    await untilConnected(b, redis)
    for (let i = 0; i < perMinute!.max; i++) await (i % 2 ? a : b).hit('post', who)
    await assert.rejects(a.hit('post', who), (err: unknown) => {
      assert.ok(is429(err))
      const { retryAfterMs } = (err as HttpException).getResponse() as { retryAfterMs: number }
      assert.ok(retryAfterMs > 0 && retryAfterMs <= perMinute!.windowMs, `retryAfterMs ${retryAfterMs}`)
      return true
    })
    for (let i = 0; i < 5; i++) await assert.rejects(b.hit('post', who), is429)
    assert.equal(await redis.get(minuteKey), String(perMinute!.max))
    assert.equal(await redis.get(hourKey), String(perMinute!.max))
    const ttl = await redis.pttl(hourKey)
    assert.ok(ttl > perHour!.windowMs - 60_000 && ttl <= perHour!.windowMs, `hour window ttl ${ttl}`)
    // Someone else's budget is untouched.
    await a.hit('post', `test-${randomUUID()}`)
  } finally {
    await redis.del(minuteKey, hourKey)
    a.onModuleDestroy()
    b.onModuleDestroy()
    redis.disconnect()
  }
})

test('with Redis down, each process still limits in its own memory', async () => {
  const down = new RedisRateLimiter({ REDIS_URL: 'redis://127.0.0.1:1' })
  try {
    for (let i = 0; i < LIMITS.post[0]!.max; i++) await down.hit('post', 'ada')
    await assert.rejects(down.hit('post', 'ada'), is429)
    await down.hit('post', 'bayo')
  } finally {
    down.onModuleDestroy()
  }
})
