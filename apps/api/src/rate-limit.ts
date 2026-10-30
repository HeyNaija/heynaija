import { isIP } from 'node:net'
import { HttpException, Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Redis } from 'ioredis'
import type { Env } from './env.js'
import { ENV } from './tokens.js'

type Window = { count: number; resetAt: number }

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** What each kind of action is allowed, per member (or per visitor, if signed out). */
export const LIMITS = {
  post: [
    { max: 10, windowMs: MINUTE },
    { max: 60, windowMs: HOUR },
  ],
  // Likes, reposts, bookmarks, follows, joins, blocks, mutes and notification
  // settings share one budget.
  action: [{ max: 120, windowMs: MINUTE }],
  report: [{ max: 10, windowMs: HOUR }],
  search: [{ max: 60, windowMs: MINUTE }],
  inviteCheck: [{ max: 20, windowMs: MINUTE }],
  // Name and bio changes.
  profile: [{ max: 20, windowMs: HOUR }],
  // Profile photo changes.
  upload: [{ max: 10, windowMs: HOUR }],
  // Downloading your own data: it reads everything, so only a few times an hour.
  export: [{ max: 5, windowMs: HOUR }],
  // Images attached to posts: up to four a post, so a bigger budget than photos.
  postImage: [
    { max: 12, windowMs: MINUTE },
    { max: 60, windowMs: HOUR },
  ],
  // Spaces (docs/adr/0017): starting one, joining (per member, and per Space so a
  // group cannot fill the room in a burst), asking to speak.
  spaceCreate: [{ max: 5, windowMs: HOUR }],
  spaceJoin: [{ max: 30, windowMs: MINUTE }],
  spaceJoinBurst: [{ max: 120, windowMs: MINUTE }],
  spaceRequest: [{ max: 10, windowMs: MINUTE }],
  spaceSync: [{ max: 20, windowMs: MINUTE }],
} satisfies Record<string, { max: number; windowMs: number }[]>

export type LimitKind = keyof typeof LIMITS

const tooMany = (retryAfterMs: number) =>
  new HttpException({ code: 'rate_limited', message: 'Too many requests. Please slow down.', retryAfterMs }, 429)

/**
 * Fixed-window counters: counts one action of `kind` by `who` and throws 429 if
 * any of that kind's limits is used up. A refused request counts toward nothing.
 */
export abstract class RateLimiter {
  abstract hit(kind: LimitKind, who: string): Promise<void>
}

/**
 * Counters in this process's memory. They reset on restart and are not shared
 * between processes: the fallback when Redis is unreachable, and for tests.
 */
export class MemoryRateLimiter extends RateLimiter {
  private readonly windows = new Map<string, Window>()

  async hit(kind: LimitKind, who: string): Promise<void> {
    this.check(kind, who)
  }

  /** `hit` with a clock, for tests. */
  check(kind: LimitKind, who: string, now = Date.now()): void {
    if (this.windows.size > 50_000) this.sweep(now)

    const rules = LIMITS[kind]
    const windows = rules.map(({ windowMs }) => {
      const key = `${kind}:${windowMs}:${who}`
      let w = this.windows.get(key)
      if (!w || w.resetAt <= now) {
        w = { count: 0, resetAt: now + windowMs }
        this.windows.set(key, w)
      }
      return w
    })

    const exhausted = windows.find((w, i) => w.count >= rules[i]!.max)
    if (exhausted) throw tooMany(exhausted.resetAt - now)
    for (const w of windows) w.count++
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key)
  }
}

export const rateLimitKey = (kind: LimitKind, windowMs: number, who: string) => `hn:limit:${kind}:${windowMs}:${who}`

// All of a kind's windows in one atomic step. KEYS are the windows' counters;
// ARGV holds each window's limit, then each window's length in ms. If any window
// is used up nothing is counted, and the reply is the ms until it resets;
// otherwise each counter goes up by one (starting its window if new) and the
// reply is 0.
const HIT = `
local n = #KEYS
for i = 1, n do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    return math.max(redis.call('PTTL', KEYS[i]), 1)
  end
end
for i = 1, n do
  if redis.call('INCR', KEYS[i]) == 1 then redis.call('PEXPIRE', KEYS[i], ARGV[n + i]) end
end
return 0`

/**
 * Counters in Redis, shared by every API process and kept across restarts. If
 * Redis cannot be reached (no offline queue, one attempt) each process counts in
 * its own memory until it can, so an outage neither stops the site nor lifts the
 * limits.
 */
@Injectable()
export class RedisRateLimiter extends RateLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimiter.name)
  private readonly redis: Redis
  private readonly fallback = new MemoryRateLimiter()

  constructor(@Inject(ENV) env: Pick<Env, 'REDIS_URL'>) {
    super()
    this.redis = new Redis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
    this.redis.on('error', (err: Error) => this.logger.warn(`rate limits counted per process: ${err.message}`))
  }

  async hit(kind: LimitKind, who: string): Promise<void> {
    const rules = LIMITS[kind]
    let retryAfterMs: number
    try {
      retryAfterMs = Number(
        await this.redis.eval(
          HIT,
          rules.length,
          ...rules.map(({ windowMs }) => rateLimitKey(kind, windowMs, who)),
          ...rules.map(({ max }) => max),
          ...rules.map(({ windowMs }) => windowMs),
        ),
      )
    } catch {
      return this.fallback.hit(kind, who)
    }
    if (retryAfterMs > 0) throw tooMany(retryAfterMs)
  }

  onModuleDestroy(): void {
    // Nothing worth flushing; quit() would wait forever on a Redis that is down.
    this.redis.disconnect()
  }
}

/**
 * Whose budget a signed-out caller draws on: their address. nginx puts it in
 * X-Real-IP (from Cloudflare's CF-Connecting-IP, trusted only from Cloudflare),
 * the web app passes it on, and the API is reachable only from the web app, so
 * callers cannot choose it. IPv6 addresses count by their /64, the block one
 * subscriber is usually given. With no address (development, tests) every
 * signed-out caller shares one budget.
 */
export function visitor(req: { headers: Record<string, string | string[] | undefined> }): string {
  const header = req.headers['x-real-ip']
  const ip = (Array.isArray(header) ? header[0] : header)?.trim() ?? ''
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1]
  if (mapped && isIP(mapped) === 4) return `ip:${mapped}`
  switch (isIP(ip)) {
    case 4:
      return `ip:${ip}`
    case 6:
      return `ip6:${ipv6Prefix(ip)}`
    default:
      return 'anonymous'
  }
}

/** The first four groups of an IPv6 address, written out in full, e.g. "2001:db8:0:0". */
function ipv6Prefix(ip: string): string {
  const [head, tail] = ip.toLowerCase().split('::') as [string, string | undefined]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')
}
