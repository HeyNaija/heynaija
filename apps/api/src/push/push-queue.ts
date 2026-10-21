import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { PUSH_JOBS, type PushJobs, PushNotificationsService } from './push-notifications.service.js'

const QUEUE = 'push'
// Writing a push is a few queries; sending it is waiting on a push service.
const CONCURRENCY = 5

type Job = { name: 'sweep'; data: Record<string, never> } | { name: 'push'; data: { memberId: string } }

const connection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** The producer side: a BullMQ queue on Redis. */
@Injectable()
export class BullPushJobs implements PushJobs, OnModuleDestroy {
  readonly queue: Queue

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue(QUEUE, {
      connection: connection(env),
      defaultJobOptions: {
        // Four tries over about two minutes, for a push service that is briefly away.
        // After ten minutes the notifications are left to email (PushNotificationsService).
        attempts: 4,
        backoff: { type: 'exponential', delay: 15_000 },
        // A finished job goes at once, so the member's next push can be queued. One
        // that failed stays ten minutes and, having the member's ID, keeps them from
        // being queued again meanwhile, by when what was waiting is too old to push.
        removeOnComplete: true,
        removeOnFail: { age: 600 },
      },
    })
  }

  async push(memberId: string): Promise<void> {
    // The member as job ID: a member has at most one push waiting to be sent.
    await this.queue.add('push', { memberId }, { jobId: `push-${memberId}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

/**
 * The consumer side, in the API process like the email, media and link workers:
 * finds the pushes that are due every few seconds and sends them. Does nothing
 * when no VAPID keys are configured.
 */
@Injectable()
export class PushWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(PushWorker.name)
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PushNotificationsService) private readonly push: PushNotificationsService,
    @Inject(PUSH_JOBS) private readonly jobs: BullPushJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.push.enabled) {
      this.log.log('Push notifications are off: PUSH_VAPID_PUBLIC_KEY is not set')
      // A sweep left from when push was on would only fill the queue.
      await this.jobs.queue.removeJobScheduler('sweep-push')
      return
    }
    await this.jobs.queue.upsertJobScheduler(
      'sweep-push',
      { every: this.env.PUSH_SWEEP_EVERY_S * 1000 },
      { name: 'sweep', data: {} },
    )
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        const { name, data } = job as unknown as Job
        if (name === 'sweep') await this.push.sweep()
        else if (name === 'push') await this.push.send(data.memberId)
      },
      { connection: connection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
