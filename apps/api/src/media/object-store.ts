import { createReadStream, createWriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
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

export type UploadedPart = { partNumber: number; size: number; etag: string }

/**
 * What video needs beyond `ObjectStore` (ADR 0019): S3 multipart uploads the
 * browser sends parts of directly, and file-based streaming and server-side copy,
 * because `read` holds a whole file in memory and a 100 MB original cannot be.
 */
export interface VideoStore extends ObjectStore {
  /** Starts a multipart upload to the private uploads bucket; returns its upload ID. */
  createMultipart(key: string, contentType: string): Promise<string>
  /** A URL a browser may PUT exactly `bytes` bytes of part `partNumber` (1-based) to, for 30 minutes. */
  presignPart(key: string, uploadId: string, partNumber: number, bytes: number): Promise<string>
  /** The parts storage already holds for an open upload. Throws when the upload no longer exists. */
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>
  /** Safe to call for an upload that is already gone. */
  abortMultipart(key: string, uploadId: string): Promise<void>
  /** Streams an object to a file, never holding it in memory. */
  download(bucket: Bucket, key: string, path: string): Promise<void>
  /** Streams a file to an object. */
  upload(bucket: Bucket, key: string, path: string, contentType: string): Promise<void>
  /** Server-side copy, between buckets or within one; the bytes do not pass through us. */
  copy(from: Bucket, fromKey: string, to: Bucket, toKey: string): Promise<void>
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
/** A part URL lives longer than an image's: a slow phone may take minutes over one 5 MiB part. */
const PART_URL_SECONDS = 30 * 60

/** Works against any S3-compatible service: MinIO locally, Cloudflare R2 in production. */
export class S3ObjectStore implements VideoStore {
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

  async createMultipart(key: string, contentType: string): Promise<string> {
    const res = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.buckets.uploads, Key: key, ContentType: contentType }))
    if (!res.UploadId) throw new Error('storage returned no upload ID')
    return res.UploadId
  }

  presignPart(key: string, uploadId: string, partNumber: number, bytes: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({ Bucket: this.buckets.uploads, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: bytes }),
      { expiresIn: PART_URL_SECONDS, signableHeaders: new Set(['content-length']) },
    )
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = []
    let marker: string | undefined
    for (;;) {
      const res = await this.client.send(new ListPartsCommand({ Bucket: this.buckets.uploads, Key: key, UploadId: uploadId, PartNumberMarker: marker }))
      for (const p of res.Parts ?? []) parts.push({ partNumber: p.PartNumber!, size: p.Size ?? 0, etag: p.ETag ?? '' })
      if (!res.IsTruncated) return parts
      marker = res.NextPartNumberMarker
    }
  }

  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.buckets.uploads,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    )
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    try {
      await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.buckets.uploads, Key: key, UploadId: uploadId }))
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchUpload') return
      throw err
    }
  }

  async download(bucket: Bucket, key: string, path: string): Promise<void> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }))
    await pipeline(res.Body as Readable, createWriteStream(path))
  }

  async upload(bucket: Bucket, key: string, path: string, contentType: string): Promise<void> {
    const { size } = await stat(path)
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets[bucket],
        Key: key,
        Body: createReadStream(path),
        ContentLength: size,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    )
  }

  async copy(from: Bucket, fromKey: string, to: Bucket, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.buckets[to],
        Key: toKey,
        CopySource: `${this.buckets[from]}/${fromKey.split('/').map(encodeURIComponent).join('/')}`,
        MetadataDirective: 'COPY',
      }),
    )
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
