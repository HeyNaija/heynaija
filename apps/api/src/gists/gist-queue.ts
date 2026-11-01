import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { type ConnectionOptions, Queue, Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { gistsEnabled } from './gists-enabled.guard.js'
import { GistsService } from './gists.service.js'

const QUEUE = 'gists'
const SCHEDULER = 'reconcile-gists'
// A lost webhook is put right within a minute, and the reconcile's two-minute
// absences (a host, a speaker) are acted on soon after they are due.
const RECONCILE_EVERY_MS = 60_000

const connection = (env: Env): ConnectionOptions => ({
  url: env.REDIS_URL,
  // Workers block on Redis; BullMQ requires retries to be left to it.
  maxRetriesPerRequest: null,
})

/**
 * Runs GistsService.reconcile once a minute while Gists are on. BullMQ's job
 * scheduler keeps it to one run a minute however many API processes there are.
 * With Gists off the schedule is taken away, so a dark feature leaves nothing running.
 */
@Injectable()
export class GistReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(GistReconciler.name)
  private queue?: Queue
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GistsService) private readonly gists: GistsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.queue = new Queue(QUEUE, {
      connection: connection(this.env),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
    })
    if (!gistsEnabled(this.env)) {
      await this.queue.removeJobScheduler(SCHEDULER)
      return
    }
    await this.queue.upsertJobScheduler(SCHEDULER, { every: RECONCILE_EVERY_MS }, { name: 'reconcile', data: {} })
    this.worker = new Worker(QUEUE, () => this.gists.reconcile(), { connection: connection(this.env) })
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
    await this.queue?.close()
  }
}
