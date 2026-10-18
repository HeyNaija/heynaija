import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { EMAIL_JOBS, type EmailJobs, EmailNotificationsService } from './email-notifications.service.js'

const QUEUE = 'email'
// Writing an email is a few queries and sending it is waiting on a mail server.
const CONCURRENCY = 3

type Job = { name: 'sweep'; data: Record<string, never> } | { name: 'digest'; data: { memberId: string } }

const connection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** The producer side: a BullMQ queue on Redis. */
@Injectable()
export class BullEmailJobs implements EmailJobs, OnModuleDestroy {
  readonly queue: Queue

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue(QUEUE, {
      connection: connection(env),
      defaultJobOptions: {
        // Five tries over about eight minutes, for a mail server that is briefly away.
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        // A finished job goes at once, so the member's next email can be queued. One
        // that failed stays an hour and, having the member's ID, keeps them from being
        // queued again meanwhile: a slow, automatic second round of tries. After a day
        // their notifications are too old to send (EmailNotificationsService).
        removeOnComplete: true,
        removeOnFail: { age: 3600 },
      },
    })
  }

  async sendDigest(memberId: string): Promise<void> {
    // The member as job ID: a member has at most one email waiting to be sent.
    await this.queue.add('digest', { memberId }, { jobId: `digest-${memberId}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

/**
 * The consumer side, in the API process for now, like the media and link
 * workers: finds the emails that are due every minute and sends them. Does
 * nothing when no mail server is configured.
 */
@Injectable()
export class EmailWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(EmailWorker.name)
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(EmailNotificationsService) private readonly email: EmailNotificationsService,
    @Inject(EMAIL_JOBS) private readonly jobs: BullEmailJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.email.enabled) {
      this.log.log('Notification emails are off: SMTP_CONNECTION_URI is not set')
      return
    }
    await this.jobs.queue.upsertJobScheduler(
      'sweep-email',
      { every: this.env.EMAIL_SWEEP_EVERY_S * 1000 },
      { name: 'sweep', data: {} },
    )
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        const { name, data } = job as unknown as Job
        if (name === 'sweep') await this.email.sweep()
        else if (name === 'digest') await this.email.sendDigest(data.memberId)
      },
      { connection: connection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
