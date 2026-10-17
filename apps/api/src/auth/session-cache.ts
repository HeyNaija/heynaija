import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { Redis } from 'ioredis'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'

export const SESSION_CACHE = Symbol('SESSION_CACHE')

/** A short-lived store of whoami answers, keyed by session cookie. */
export interface SessionCache {
  get(cookie: string): Promise<string | null>
  set(cookie: string, value: string, ttlSeconds: number): Promise<void>
  delete(cookie: string): Promise<void>
}

/**
 * The cookie is a bearer credential, so it never reaches Redis: keys are its
 * SHA-256. A Redis dump or `MONITOR` shows nothing anyone could sign in with.
 */
export const sessionCacheKey = (cookie: string) =>
  `hn:whoami:${createHash('sha256').update(cookie).digest('hex')}`

/**
 * Redis is an optimisation here, never a dependency: when it is down every call
 * fails fast (no offline queue, one attempt) and the caller asks Kratos instead.
 */
@Injectable()
export class RedisSessionCache implements SessionCache, OnModuleDestroy {
  private readonly logger = new Logger(RedisSessionCache.name)
  private readonly redis: Redis

  constructor(@Inject(ENV) env: Pick<Env, 'REDIS_URL'>) {
    this.redis = new Redis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 })
    this.redis.on('error', (err: Error) => this.logger.warn(`session cache unavailable: ${err.message}`))
  }

  async get(cookie: string): Promise<string | null> {
    try {
      return await this.redis.get(sessionCacheKey(cookie))
    } catch {
      return null
    }
  }

  async set(cookie: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(sessionCacheKey(cookie), value, 'EX', ttlSeconds)
    } catch {
      // Not cached; the next request asks Kratos again.
    }
  }

  async delete(cookie: string): Promise<void> {
    try {
      await this.redis.del(sessionCacheKey(cookie))
    } catch {
      // Expires on its own within the TTL.
    }
  }

  onModuleDestroy(): void {
    // Nothing worth flushing; quit() would wait forever on a Redis that is down.
    this.redis.disconnect()
  }
}
