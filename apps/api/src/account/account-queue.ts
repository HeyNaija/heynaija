import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { AccountDeletionService } from './account-deletion.service.js'
import { failureReason } from './failure-reason.js'
import { PrivacyRequestsService } from './privacy-requests.service.js'
import { RetentionService } from './retention.service.js'

const QUEUE = 'account'
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// An erase that fails is tried again 1, 2, 4 … 64 minutes later: eight tries over
// about two hours, for Kratos or storage being away for a while.
const ERASE_ATTEMPTS = 8
// One that failed every time is kept a day. Its job ID stays taken meanwhile, so
// the hourly look for due erases cannot queue it; after that it has another round.
const ERASE_FAILED_KEEP_S = 24 * 3600

type Job =
  | { name: 'queue-due'; data: Record<string, never> }
  | { name: 'erase'; data: { memberId: string } }
  | { name: 'retention'; data: Record<string, never> }
  | { name: 'overdue'; data: Record<string, never> }

type FailedJob = { name: string; id?: string; data: unknown; attemptsMade: number; opts: { attempts?: number } }

const connection = (env: Pick<Env, 'REDIS_URL'>): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** The producer side: a BullMQ queue on Redis. */
@Injectable()
export class BullAccountJobs implements OnModuleDestroy {
  readonly queue: Queue

  // Only Redis: the privacy-request command queues erases with this too.
  constructor(@Inject(ENV) env: Pick<Env, 'REDIS_URL'>) {
    this.queue = new Queue(QUEUE, {
      connection: connection(env),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    })
  }

  async erase(memberId: string): Promise<void> {
    // The member as job ID: an account is never queued for erasing twice. A finished
    // job goes at once: kept, it would stop a later deletion of the same account
    // (asked for again after a cancel) from being queued.
    await this.queue.add(
      'erase',
      { memberId },
      {
        jobId: `erase-${memberId}`,
        attempts: ERASE_ATTEMPTS,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { age: ERASE_FAILED_KEEP_S },
      },
    )
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

/**
 * The consumer side, in the API process like the other workers. Every hour it
 * queues the erases that are due and lets go of what was kept only for a while;
 * every day it warns of privacy requests past their due date (docs/adr/0016).
 * Logs carry counts and IDs only, never emails, handles or content.
 */
@Injectable()
export class AccountWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(AccountWorker.name)
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(AccountDeletionService) private readonly deletion: Pick<AccountDeletionService, 'due' | 'erase'>,
    @Inject(RetentionService) private readonly retention: Pick<RetentionService, 'sweep'>,
    @Inject(PrivacyRequestsService) private readonly requests: Pick<PrivacyRequestsService, 'overdue'>,
    @Inject(BullAccountJobs) private readonly jobs: Pick<BullAccountJobs, 'erase' | 'queue'>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.queue.upsertJobScheduler('erase-due', { every: HOUR_MS }, { name: 'queue-due', data: {} })
    await this.jobs.queue.upsertJobScheduler('sweep-retention', { every: HOUR_MS }, { name: 'retention', data: {} })
    await this.jobs.queue.upsertJobScheduler('check-overdue', { every: DAY_MS }, { name: 'overdue', data: {} })
    // One job at a time: erases are rare, and each holds its member's row locked.
    this.worker = new Worker(QUEUE, (job) => this.run(job as unknown as Job), { connection: connection(this.env), concurrency: 1 })
    this.worker.on('failed', (job, err) => this.failed(job, err))
  }

  async run(job: Job, now = new Date()): Promise<void> {
    try {
      if (job.name === 'queue-due') {
        for (const memberId of await this.deletion.due(now)) await this.jobs.erase(memberId)
      } else if (job.name === 'erase') {
        // An erase logs what it did; one cancelled first did nothing to log.
        await this.deletion.erase(job.data.memberId, now)
      } else if (job.name === 'retention') {
        const { posts, handles } = await this.retention.sweep(now)
        if (posts) this.log.log(`blanked ${posts} deleted posts kept longer than DELETED_CONTENT_RETENTION_DAYS`)
        if (handles) this.log.log(`let go of ${handles} handles held for erased accounts`)
      } else if (job.name === 'overdue') {
        const overdue = await this.requests.overdue(now)
        if (overdue.length) {
          const list = overdue.map((r) => `${r.id} (${r.kind}, due ${r.dueBy.toISOString().slice(0, 10)})`).join(', ')
          this.log.warn(`${overdue.length} privacy requests are past their due date: ${list}`)
        }
      }
    } catch (err) {
      throw new Error(failureReason(err))
    }
  }

  failed(job: FailedJob | undefined, err: Error): void {
    if (job?.name === 'erase' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const { memberId } = job.data as { memberId: string }
      this.log.error(
        `gave up erasing member ${memberId} after ${job.attemptsMade} tries (${err.message}). The account stays off the site and the erase is tried again in a day.`,
      )
    } else {
      this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`)
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
