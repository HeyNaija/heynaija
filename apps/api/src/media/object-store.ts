import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type Bucket = 'uploads' | 'media'

/**
 * The little we need from object storage. Two buckets: `uploads` is private and
 * holds raw files exactly as a browser sent them; `media` is publicly readable
 * and only ever receives files this API has checked and re-encoded.
 */
export interface ObjectStore {
  /** A URL a browser may PUT exactly `bytes` bytes of `contentType` to, for a few minutes. */
  presignUpload(key: string, contentType: string, bytes: number): Promise<string>
  /** Size in bytes, or null if nothing is stored under `key`. */
  size(bucket: Bucket, key: string): Promise<number | null>
  read(bucket: Bucket, key: string): Promise<Buffer>
  write(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void>
  remove(bucket: Bucket, key: string): Promise<void>
}

export type S3Config = {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  uploadsBucket: string
  mediaBucket: string
}

const UPLOAD_URL_SECONDS = 300

/** Works against any S3-compatible service: MinIO locally, Cloudflare R2 in production. */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client
  private readonly buckets: Record<Bucket, string>

  constructor(config: S3Config) {
    this.buckets = { uploads: config.uploadsBucket, media: config.mediaBucket }
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // MinIO needs bucket-in-path URLs; R2 accepts them too.
      forcePathStyle: true,
      // Newer SDKs add checksum headers a browser upload cannot supply.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  presignUpload(key: string, contentType: string, bytes: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.buckets.uploads, Key: key, ContentType: contentType, ContentLength: bytes }),
      {
        expiresIn: UPLOAD_URL_SECONDS,
        // Signing these makes the storage service itself refuse a different type or size.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    )
  }

  async size(bucket: Bucket, key: string): Promise<number | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.buckets[bucket], Key: key }))
      return head.ContentLength ?? 0
    } catch (err) {
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  async read(bucket: Bucket, key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }

  async write(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: body,
        ContentType: contentType,
        // Every processed file gets a new key, so it can be cached forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    )
  }

  async remove(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key }))
  }

  /**
   * Local development only: creates both buckets and lets anyone read the media
   * one. On R2 the buckets and public access are set up in the Cloudflare dashboard.
   */
  async ensureDevBuckets(): Promise<void> {
    for (const name of Object.values(this.buckets)) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: name }))
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: name }))
      }
    }
    await this.client.send(
      new PutBucketPolicyCommand({
        Bucket: this.buckets.media,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${this.buckets.media}/*`],
            },
          ],
        }),
      }),
    )
  }
}
