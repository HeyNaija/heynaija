import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Ory Kratos public API, reached server-to-server to validate sessions.
  KRATOS_PUBLIC_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  // Shared secret Kratos presents when it calls our registration webhook.
  KRATOS_WEBHOOK_SECRET: z.string().min(32),
  // Origin browsers use for the web app; the only origin allowed to make writes.
  WEB_PUBLIC_URL: z
    .url()
    .default('http://127.0.0.1:3000')
    .transform((u) => u.replace(/\/$/, '')),
  API_PORT: z.coerce.number().default(4000),
  // Loopback in development. In a container it must be 0.0.0.0 so the web app and
  // Kratos can reach it; the port is never published outside the Docker network.
  API_HOST: z.string().default('127.0.0.1'),
  // Background jobs (image processing) run on BullMQ over this Redis.
  REDIS_URL: z.url(),
  // How long a Kratos whoami answer is reused for the same session cookie, in
  // seconds (see KratosService). 0 asks Kratos on every request.
  WHOAMI_CACHE_TTL_S: z.coerce.number().int().min(0).max(300).default(30),
  // Object storage for media: MinIO locally, Cloudflare R2 in production.
  S3_ENDPOINT: z.url().transform((u) => u.replace(/\/$/, '')),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_UPLOADS_BUCKET: z.string().min(1),
  S3_MEDIA_BUCKET: z.string().min(1),
})

export type Env = z.infer<typeof schema>

export const loadEnv = (): Env => schema.parse(process.env)
