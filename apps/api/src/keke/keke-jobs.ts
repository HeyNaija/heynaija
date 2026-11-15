import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'

export const KEKE_JOBS = Symbol('KEKE_JOBS')

/** What posts need from Keke (docs/adr/0030): to be told a post mentions it. */
export interface KekeJobs {
  answer(postId: string): Promise<void>
}

export const KEKE_QUEUE = 'keke'

export type KekeJob = { name: 'answer'; data: { postId: string } }

export const kekeConnection = (env: Pick<Env, 'REDIS_URL'>): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** Whether this server has a model for Keke at all: either key turns it on (docs/adr/0030). */
export const kekeConfigured = (env: Pick<Env, 'ANTHROPIC_API_KEY' | 'OPENROUTER_API_KEY'>): boolean =>
  Boolean(env.ANTHROPIC_API_KEY || env.OPENROUTER_API_KEY)

/**
 * The producer side: a BullMQ queue on Redis. It needs only the settings, so
 * posts can hold it without depending on Keke. With no model key nothing is
 * queued, as nothing is pushed without push's keys.
 */
@Injectable()
export class BullKekeJobs implements KekeJobs, OnModuleDestroy {
  readonly queue: Queue
  private readonly on: boolean

  constructor(@Inject(ENV) env: Env) {
    this.on = kekeConfigured(env)
    this.queue = new Queue(KEKE_QUEUE, {
      connection: kekeConnection(env),
      defaultJobOptions: {
        // A second try for a database or Redis hiccup. The model call has its own
        // retries, and the answer checks Keke has not replied already.
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    })
  }

  async answer(postId: string): Promise<void> {
    if (!this.on) return
    // The post as job ID: queued twice, it is answered once.
    await this.queue.add('answer', { postId }, { jobId: `answer-${postId}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
