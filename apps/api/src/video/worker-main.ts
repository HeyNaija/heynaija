import { readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb } from '@heynaija/db'
import { Worker } from 'bullmq'
import { smtpMailer } from '../email/mailer.js'
import { NoScanner } from '../media/media.service.js'
import { S3ObjectStore } from '../media/object-store.js'
import { describeScanner, scannerFromEnv } from '../media/scanners.js'
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

const scanner = scannerFromEnv(env)
if (scanner instanceof NoScanner) {
  // Said once, loudly, at start. Per video it is said again when one is held.
  console.error(
    [
      '!!! NO UPLOAD SCANNER IS CONFIGURED (neither ARACHNID_SHIELD_* nor PHOTODNA_* is set) !!!',
      '!!! Every video will be held in QUARANTINE and none will be published.    !!!',
      '!!! This is deliberate: video fails closed. See docs/safety/video-scanning.md. !!!',
    ].join('\n'),
  )
}

// Scratch is a disk volume (ADR 0021 section 5), which outlives the container: a job cut off by a
// restart leaves its folder behind, so whatever is there from before goes now. One worker per volume.
for (const name of await readdir(tmpdir())) if (name.startsWith('video-')) await rm(join(tmpdir(), name), { recursive: true, force: true })

const processor = new VideoProcessor(db, store, scanner, cfg, new EmailSafetyAlerts(smtpMailer(env), env.SAFETY_ALERT_EMAIL, env.WEB_PUBLIC_URL))

const worker = new Worker(
  VIDEO_QUEUE,
  async (job) => {
    const { mediaId } = job.data as { mediaId: string }
    await processor.process(mediaId, { lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) })
  },
  // BullMQ renews the lock every half of this while a job runs, so an encode of up to the job's limit
  // (22 minutes for a 3-minute clip) keeps it; a worker that dies loses it within 10 minutes.
  { connection: videoConnection(env), concurrency: 1, lockDuration: 10 * 60_000 },
)
worker.on('failed', (job, err) => console.error(`video job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`))
worker.on('error', (err) => console.error(`video worker error: ${err.message}`))
console.log(`video worker ready: ${cfg.maxSeconds}s / ${Math.floor(cfg.maxBytes / 1024 / 1024)} MB / ${cfg.maxEdge}px limits, scanner: ${describeScanner(scanner)}`)

const stop = async () => {
  await worker.close()
  await pool.end()
  process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
