import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { HIGHLIGHTS_JOBS, type HighlightsJobs, HighlightsService } from './highlights.service.js'

const QUEUE = 'highlights'
// Choosing a member's highlights is one query; sending is waiting on a push or mail server.
const CONCURRENCY = 3

type Job = { name: 'sweep'; data: Record<string, never> } | { name: 'send'; data: { memberId: string } }

const connection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** The producer side: a BullMQ queue on Redis. */
@Injectable()
export class BullHighlightsJobs implements HighlightsJobs, OnModuleDestroy {
  readonly queue: Queue

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue(QUEUE, {
      connection: connection(env),
      defaultJobOptions: {
        // Four tries over about seven minutes, for a mail or push server that is briefly away.
        attempts: 4,
        backoff: { type: 'exponential', delay: 60_000 },
        // A finished job goes at once. One that failed stays an hour and, having the
        // member's ID, keeps them from being queued again meanwhile; the run is open
        // for a day, so a later pass tries them again.
        removeOnComplete: true,
        removeOnFail: { age: 3600 },
      },
    })
  }

  async send(memberId: string): Promise<void> {
    // The member as job ID: a member has at most one waiting to be sent.
    await this.queue.add('send', { memberId }, { jobId: `highlights-${memberId}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

/**
 * The consumer side, in the API process like the email and push workers: every
 * few minutes it looks for members the week's run has not dealt with, and sends
 * each their highlights. Does nothing when there is neither a mail server nor
 * anything to push with. Whether anything is sent is the weeklyHighlights flag's
 * to say, read on every pass, so turning it on or off needs no restart.
 */
@Injectable()
export class HighlightsWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(HighlightsWorker.name)
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HighlightsService) private readonly highlights: HighlightsService,
    @Inject(HIGHLIGHTS_JOBS) private readonly jobs: BullHighlightsJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.highlights.enabled) {
      this.log.log('Weekly highlights are off: there is neither a mail server nor anything to push with')
      // A sweep left from when they were on would only fill the queue.
      await this.jobs.queue.removeJobScheduler('sweep-highlights')
      return
    }
    await this.jobs.queue.upsertJobScheduler(
      'sweep-highlights',
      { every: this.env.HIGHLIGHTS_SWEEP_EVERY_S * 1000 },
      { name: 'sweep', data: {} },
    )
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        const { name, data } = job as unknown as Job
        if (name === 'sweep') await this.highlights.sweep()
        else if (name === 'send') await this.highlights.send(data.memberId)
      },
      { connection: connection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
