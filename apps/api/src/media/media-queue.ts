import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { MEDIA_JOBS, type MediaJobs, MediaService } from './media.service.js'

const QUEUE = 'media'
const SWEEP_EVERY_MS = 60 * 60 * 1000
// Re-encoding is CPU work in the API process; two at a time leaves room for requests.
const CONCURRENCY = 2

type Job = { name: 'post-image'; data: { mediaId: string } } | { name: 'sweep'; data: Record<string, never> }

const connection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/** The producer side: a BullMQ queue on Redis. */
@Injectable()
export class BullMediaJobs implements MediaJobs, OnModuleDestroy {
  readonly queue: Queue

  constructor(@Inject(ENV) env: Env) {
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

  async processPostImage(mediaId: string): Promise<void> {
    // The media ID as job ID: queueing the same upload twice runs it once.
    await this.queue.add('post-image', { mediaId }, { jobId: `post-image-${mediaId}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}

/**
 * The consumer side, in the API process for now: processes post images and,
 * hourly, clears uploads nobody finished or used. It can move to its own process
 * later without changing the producer.
 */
@Injectable()
export class MediaWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(MediaWorker.name)
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(MEDIA_JOBS) private readonly jobs: BullMediaJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.queue.upsertJobScheduler('sweep-abandoned', { every: SWEEP_EVERY_MS }, { name: 'sweep', data: {} })
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        const { name, data } = job as unknown as Job
        if (name === 'post-image') await this.media.processPostImage(data.mediaId)
        else if (name === 'sweep') await this.media.sweepAbandoned()
      },
      { connection: connection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
