import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { VIDEO_QUEUE } from './video-config.js'
import type { VideoJobs } from './video.service.js'

/** Three attempts, exponential from 30 s (ADR 0019 section 3.5). */
export const VIDEO_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const

export const videoConnection = (env: Pick<Env, 'REDIS_URL'>): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/**
 * The producer side, in the API: a `video` queue of its own, so a slow encode can
 * never hold up image jobs or CDN purges. The consumer is the separate video-worker
 * process (worker-main.ts), where ffmpeg lives.
 */
@Injectable()
export class BullVideoJobs implements VideoJobs, OnModuleDestroy {
  readonly queue: Queue

  constructor(@Inject(ENV) env: Env) {
    this.queue = new Queue(VIDEO_QUEUE, { connection: videoConnection(env), defaultJobOptions: VIDEO_JOB_OPTIONS })
  }

  async processVideo(mediaId: string): Promise<void> {
    // The media ID as job ID: queueing the same upload twice runs it once.
    await this.queue.add('process-video', { mediaId }, { jobId: `video-${mediaId}` })
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close()
  }
}
