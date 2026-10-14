// Local development only: creates the two storage buckets on MinIO and makes the
// media one publicly readable. Usage: pnpm media:init
import { loadEnv } from '../env.js'
import { S3ObjectStore } from '../media/object-store.js'
import { s3Config } from '../media/s3-config.js'

const env = loadEnv()
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(env.S3_ENDPOINT)) {
  console.error(`Refusing to run against ${env.S3_ENDPOINT}: this command is for a local MinIO only.`)
  process.exit(1)
}
await new S3ObjectStore(s3Config(env)).ensureDevBuckets()
console.log(`buckets ready: ${env.S3_UPLOADS_BUCKET} (private), ${env.S3_MEDIA_BUCKET} (public read)`)
