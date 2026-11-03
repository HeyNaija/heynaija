import { createDb } from '@heynaija/db'
import { Worker } from 'bullmq'
import { smtpMailer } from '../email/mailer.js'
import { type ContentScanner, NoScanner } from '../media/media.service.js'
import { S3ObjectStore } from '../media/object-store.js'
import { PhotoDnaScanner } from '../media/photodna.js'
import { EmailSafetyAlerts } from '../moderation/safety-alerts.js'
import { VIDEO_QUEUE } from './video-config.js'
import { VideoProcessor } from './video-processor.js'
import { videoConnection } from './video-queue.js'
import { loadWorkerEnv, workerVideoConfig } from './worker-env.js'

/**
 * The video worker: one process, one video at a time (ADR 0019 section 3.4),
 * consuming the `video` queue the API fills. It runs ffmpeg, so it is the only
 * place ffmpeg is installed (the `video-worker` Dockerfile target).
 */
const env = loadWorkerEnv()
const cfg = workerVideoConfig(env)
const { db, pool } = createDb(env.DATABASE_URL)

const store = new S3ObjectStore({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  uploadsBucket: env.S3_UPLOADS_BUCKET,
  mediaBucket: env.S3_MEDIA_BUCKET,
})

const scanner: ContentScanner = env.PHOTODNA_SUBSCRIPTION_KEY ? new PhotoDnaScanner(env.PHOTODNA_SUBSCRIPTION_KEY, env.PHOTODNA_MATCH_URL) : new NoScanner()
if (scanner instanceof NoScanner) {
  // Said once, loudly, at start. Per video it is said again when one is held.
  console.error(
    [
      '!!! NO UPLOAD SCANNER IS CONFIGURED (PHOTODNA_SUBSCRIPTION_KEY is not set) !!!',
      '!!! Every video will be held in QUARANTINE and none will be published.    !!!',
      '!!! This is deliberate: video fails closed. See docs/safety/video-scanning.md. !!!',
    ].join('\n'),
  )
}

const processor = new VideoProcessor(db, store, scanner, cfg, new EmailSafetyAlerts(smtpMailer(env), env.SAFETY_ALERT_EMAIL, env.WEB_PUBLIC_URL))

const worker = new Worker(
  VIDEO_QUEUE,
  async (job) => {
    const { mediaId } = job.data as { mediaId: string }
    await processor.process(mediaId, { lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) })
  },
  // An encode may take up to the 5 minute ffmpeg limit; the lock must outlive it.
  { connection: videoConnection(env), concurrency: 1, lockDuration: 10 * 60_000 },
)
worker.on('failed', (job, err) => console.error(`video job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`))
worker.on('error', (err) => console.error(`video worker error: ${err.message}`))
console.log(`video worker ready: ${cfg.maxSeconds}s / ${Math.floor(cfg.maxBytes / 1024 / 1024)} MB / ${cfg.maxEdge}px limits, scanner: ${scanner instanceof NoScanner ? 'NONE (fail closed)' : 'PhotoDNA'}`)

const stop = async () => {
  await worker.close()
  await pool.end()
  process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
