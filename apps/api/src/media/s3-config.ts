import type { Env } from '../env.js'
import type { S3Config } from './object-store.js'

export const s3Config = (env: Env): S3Config => ({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  uploadsBucket: env.S3_UPLOADS_BUCKET,
  mediaBucket: env.S3_MEDIA_BUCKET,
})
