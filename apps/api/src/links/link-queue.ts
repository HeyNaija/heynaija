import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { LINK_JOBS, type LinkJobs, LinksService } from './links.service.js'

const QUEUE = 'links'
const SWEEP_EVERY_MS = 60 * 60 * 1000
// Reading other people's pages is mostly waiting, but each one can be slow: a few
// at a time, so one dead site does not hold up the rest.
const CONCURRENCY = 4

type Job = { name: 'preview'; data: { url: string } } | { name: 'sweep'; data: Record<string, never> }

const connection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** The producer side: a BullMQ queue on Redis. */
@Injectable()
export class BullLinkJobs implements LinkJobs, OnModuleDestroy {
  readonly queue: Queue

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue(QUEUE, {
      connection: connection(env),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        // Finished jobs go at once, so the same address can be queued again when its preview is due.
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    })
  }

  async buildPreview(url: string): Promise<void> {
    // The address as job ID: queueing it twice while one is waiting runs it once.
    await this.queue.add('preview', { url }, { jobId: `preview-${createHash('sha1').update(url).digest('hex')}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

/** The consumer side, in the API process for now, like the media worker. */
@Injectable()
export class LinkWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(LinkWorker.name)
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(LinksService) private readonly links: LinksService,
    @Inject(LINK_JOBS) private readonly jobs: BullLinkJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.queue.upsertJobScheduler('sweep-links', { every: SWEEP_EVERY_MS }, { name: 'sweep', data: {} })
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        const { name, data } = job as unknown as Job
        if (name === 'preview') await this.links.buildPreview(data.url)
        else if (name === 'sweep') await this.links.sweep()
      },
      { connection: connection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
