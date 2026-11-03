import { z } from 'zod'
import { videoConfig, videoEnvShape } from './video-config.js'

const optional = <T extends z.ZodType>(type: T) => z.preprocess((value) => (value === '' ? undefined : value), type.optional())

/**
 * What the video worker reads: storage, the database, Redis, the scanner and the
 * safety alert address. The code asks for no more than this and fails to start without
 * the required ones; it does not stop other variables being present. What the
 * container is actually given is set by the `video-worker` service in
 * `infra/deploy/compose.yml`, which lists exactly these and nothing else.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.url(),
  S3_ENDPOINT: z.url().transform((u) => u.replace(/\/$/, '')),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_UPLOADS_BUCKET: z.string().min(1),
  S3_MEDIA_BUCKET: z.string().min(1),
  PHOTODNA_SUBSCRIPTION_KEY: optional(z.string().min(1)),
  PHOTODNA_MATCH_URL: optional(z.url()),
  SAFETY_ALERT_EMAIL: optional(z.email()),
  SMTP_CONNECTION_URI: optional(z.string().min(1)),
  SMTP_FROM_ADDRESS: optional(z.email()),
  SMTP_FROM_NAME: z.string().min(1).default('HeyNaija'),
  WEB_PUBLIC_URL: z.url().default('http://127.0.0.1:3000').transform((u) => u.replace(/\/$/, '')),
  ...videoEnvShape,
})

export type WorkerEnv = z.infer<typeof schema>

export const loadWorkerEnv = (source: Record<string, string | undefined> = process.env): WorkerEnv => schema.parse(source)
export const workerVideoConfig = (env: WorkerEnv) => videoConfig(env)
