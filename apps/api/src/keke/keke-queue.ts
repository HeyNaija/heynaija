import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common'
import { Worker } from 'bullmq'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { type BullKekeJobs, KEKE_JOBS, KEKE_QUEUE, type KekeJob, kekeConfigured, kekeConnection } from './keke-jobs.js'
import { KekeService } from './keke.service.js'
import { lagosDay, lagosTime, NEWS_RULE } from './news-rule.js'
import { KekeNews } from './news.service.js'

/** A daily cron pattern for `hour:minute`, read in Nigerian time by the scheduler. */
const daily = ({ hour, minute }: { hour: number; minute: number }) => `${minute} ${hour} * * *`
const SCHEDULES = [
  // On the quarter hour, away from the draft at half past and the post on the hour.
  { id: 'keke-news-collect', name: 'news-collect', pattern: '15 * * * *' },
  { id: 'keke-news-draft', name: 'news-draft', pattern: daily(NEWS_RULE.draftAt) },
  // A morning that failed is tried again; any other day's draft is left as it is (`draft` says 'exists').
  ...NEWS_RULE.retryAt.map((at, i) => ({ id: `keke-news-draft-retry-${i + 1}`, name: 'news-draft', pattern: daily(at) })),
  { id: 'keke-news-publish', name: 'news-publish', pattern: daily(NEWS_RULE.publishAt) },
]

// Each answer is mostly waiting on the model. A few at a time keeps one slow answer
// from holding up the rest without letting a burst of mentions run up the bill at once.
const CONCURRENCY = 2

/**
 * The consumer side, in the API process like the other workers: answers the
 * posts that mention Keke. Does nothing when the server has no model key.
 * Whether Keke answers anyone is the keke flag's to say, read for each post, so
 * turning it on or off needs no restart.
 */
@Injectable()
export class KekeWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Keke')
  private worker?: Worker

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(KekeService) private readonly keke: KekeService,
    @Inject(KekeNews) private readonly news: KekeNews,
    @Inject(KEKE_JOBS) private readonly jobs: BullKekeJobs,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!kekeConfigured(this.env)) {
      this.log.log('Keke is off: neither ANTHROPIC_API_KEY nor OPENROUTER_API_KEY is set')
      // Schedules left from when it was on would only fill the queue.
      for (const s of SCHEDULES) await this.jobs.queue.removeJobScheduler(s.id)
      return
    }
    // Whether there is news is the kekeNews flag's to say, read when each job runs.
    for (const s of SCHEDULES) {
      await this.jobs.queue.upsertJobScheduler(s.id, { pattern: s.pattern, tz: 'Africa/Lagos' }, { name: s.name, data: {} })
    }
    // A read now, so a server just started does not wait for the quarter hour to begin keeping headlines.
    const now = new Date()
    const day = lagosDay(now)
    await this.jobs.queue.add('news-collect', {}, { jobId: `news-collect-start-${day}-${now.getUTCHours()}` })
    // Started between the draft and the post (a deploy at 06:00): today's draft now, if it was missed.
    if (now >= lagosTime(day, NEWS_RULE.draftAt) && now < lagosTime(day, NEWS_RULE.publishAt)) {
      await this.jobs.queue.add('news-draft', {}, { jobId: `news-draft-${day}` })
    }
    this.worker = new Worker(
      KEKE_QUEUE,
      async (job) => {
        const { name, data } = job as unknown as KekeJob
        if (name === 'answer') {
          const result = await this.keke.answer(data.postId)
          if (result.done === 'failed') this.log.warn(`no answer for ${data.postId}: every model failed`)
        } else if (name === 'news-collect') {
          const read = await this.news.collect()
          if (read !== 'off') this.log.log(`news feeds read: ${read.kept} new headlines${read.failed.length ? `; failed: ${read.failed.join(', ')}` : ''}`)
        } else if (name === 'news-draft') {
          this.log.log(`daily news draft: ${await this.news.draft()}`)
        } else if (name === 'news-publish') {
          this.log.log(`daily news: ${await this.news.publish()}`)
        }
      },
      { connection: kekeConnection(this.env), concurrency: CONCURRENCY },
    )
    this.worker.on('failed', (job, err) => this.log.warn(`${job?.name} ${job?.id} failed: ${err.message}`))
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close()
  }
}
