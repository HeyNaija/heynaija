import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpException } from '@nestjs/common'
import { LIMITS, RateLimiter } from './rate-limit.js'

const is429 = (err: unknown) => err instanceof HttpException && err.getStatus() === 429

test('allows up to the limit, then refuses until the window passes', () => {
  const limiter = new RateLimiter()
  const perMinute = LIMITS.post[0]!.max
  for (let i = 0; i < perMinute; i++) limiter.hit('post', 'ada', 1000)
  assert.throws(() => limiter.hit('post', 'ada', 1000), is429)
  assert.throws(() => limiter.hit('post', 'ada', 59_999), is429)
  limiter.hit('post', 'ada', 61_001)
})

test('each member and each kind of action has its own budget', () => {
  const limiter = new RateLimiter()
  for (let i = 0; i < LIMITS.post[0]!.max; i++) limiter.hit('post', 'ada', 0)
  assert.throws(() => limiter.hit('post', 'ada', 0), is429)
  limiter.hit('post', 'bayo', 0)
  limiter.hit('action', 'ada', 0)
})

test('the hourly limit holds even when the per-minute one keeps resetting', () => {
  const limiter = new RateLimiter()
  const [perMinute, perHour] = LIMITS.post
  let now = 0
  let sent = 0
  for (; sent < perHour!.max; sent++) {
    if (sent > 0 && sent % perMinute!.max === 0) now += perMinute!.windowMs + 1
    limiter.hit('post', 'ada', now)
  }
  now += perMinute!.windowMs + 1
  assert.throws(() => limiter.hit('post', 'ada', now), is429)
  limiter.hit('post', 'ada', perHour!.windowMs + 1)
})

test('a refused request does not use up budget in the other windows', () => {
  const limiter = new RateLimiter()
  const perMinute = LIMITS.post[0]!.max
  for (let i = 0; i < perMinute; i++) limiter.hit('post', 'ada', 0)
  for (let i = 0; i < 500; i++) assert.throws(() => limiter.hit('post', 'ada', 0), is429)
  // Had those 500 refusals counted toward the hour, this would now be refused too.
  limiter.hit('post', 'ada', 60_001)
})
