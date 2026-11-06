import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { DeleteBucketCommand, DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { S3ObjectStore } from '../media/object-store.js'

/**
 * The R2 presigned-multipart spike (ADR 0019 section 2), run against LOCAL MinIO only:
 * there is no R2 account, so what R2 does stays unverified (docs/video-spike.md).
 *
 * Skipped unless VIDEO_SPIKE_S3_ENDPOINT, _KEY and _SECRET name an S3-compatible
 * service. It makes and removes its own bucket, so it never touches the real ones.
 */
const endpoint = process.env.VIDEO_SPIKE_S3_ENDPOINT
const accessKeyId = process.env.VIDEO_SPIKE_S3_KEY
const secretAccessKey = process.env.VIDEO_SPIKE_S3_SECRET
const skip = !(endpoint && accessKeyId && secretAccessKey) && 'set VIDEO_SPIKE_S3_ENDPOINT, VIDEO_SPIKE_S3_KEY and VIDEO_SPIKE_S3_SECRET (local MinIO) to run the multipart spike'

const bucket = `video-spike-${randomUUID().slice(0, 8)}`
const media = `${bucket}-media`
const MIB = 1024 * 1024

let raw: S3Client
let store: S3ObjectStore
let dir: string

before(async () => {
  if (skip) return
  raw = new S3Client({ endpoint, region: 'us-east-1', credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! }, forcePathStyle: true })
  store = new S3ObjectStore({ endpoint: endpoint!, region: 'us-east-1', accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!, uploadsBucket: bucket, mediaBucket: media })
  await store.ensureDevBuckets() // both buckets, the media one publicly readable, as in development
  dir = await mkdtemp(join(tmpdir(), 'video-spike-'))
})

after(async () => {
  if (skip) return
  for (const b of [bucket, media]) {
    // A page at a time: the listing test leaves more than one.
    for (let listed = await raw.send(new ListObjectsV2Command({ Bucket: b })); listed.Contents?.length; listed = await raw.send(new ListObjectsV2Command({ Bucket: b }))) {
      await Promise.all(listed.Contents.map((o) => raw.send(new DeleteObjectCommand({ Bucket: b, Key: o.Key }))))
    }
    await raw.send(new DeleteBucketCommand({ Bucket: b }))
  }
  await rm(dir, { recursive: true, force: true })
})

const put = async (url: string, body: Buffer, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body), headers })
  return { status: res.status, etag: res.headers.get('etag'), text: await res.text() }
}

test('multipart: signed parts go straight to storage, resume lists them, complete assembles the object', { skip }, async () => {
  const key = 'videos/spike-1'
  const parts = [Buffer.alloc(5 * MIB, 1), Buffer.alloc(5 * MIB, 2), Buffer.alloc(1 * MIB, 3)]
  const uploadId = await store.createMultipart(key, 'video/mp4')
  assert.ok(uploadId.length > 5)

  // Only part 1 and 2 arrive, as if the connection dropped.
  const done: { partNumber: number; etag: string }[] = []
  for (const n of [1, 2]) {
    const url = await store.presignPart(key, uploadId, n, parts[n - 1]!.length)
    const res = await put(url, parts[n - 1]!)
    assert.equal(res.status, 200, res.text)
    assert.ok(res.etag)
    done.push({ partNumber: n, etag: res.etag! })
  }

  // After a reload: what is already there, so only the rest is sent.
  const listed = await store.listParts(key, uploadId)
  assert.deepEqual(listed.map((p) => [p.partNumber, p.size]), [[1, 5 * MIB], [2, 5 * MIB]])

  const last = await put(await store.presignPart(key, uploadId, 3, parts[2]!.length), parts[2]!)
  assert.equal(last.status, 200)
  done.push({ partNumber: 3, etag: last.etag! })

  await store.completeMultipart(key, uploadId, done)
  assert.equal(await store.size('uploads', key), 11 * MIB)
})

test('multipart: a part signed for one size refuses another (content-length is signed)', { skip }, async () => {
  const key = 'videos/spike-2'
  const uploadId = await store.createMultipart(key, 'video/mp4')
  const url = await store.presignPart(key, uploadId, 1, 5 * MIB)
  const res = await put(url, Buffer.alloc(6 * MIB, 1))
  assert.notEqual(res.status, 200)
  await store.abortMultipart(key, uploadId)
})

test('multipart: aborting removes the open upload and any parts', { skip }, async () => {
  const key = 'videos/spike-3'
  const uploadId = await store.createMultipart(key, 'video/mp4')
  await put(await store.presignPart(key, uploadId, 1, 5 * MIB), Buffer.alloc(5 * MIB, 1))
  await store.abortMultipart(key, uploadId)
  assert.equal(await store.size('uploads', key), null)
  await assert.rejects(() => store.listParts(key, uploadId))
})

test('download and upload stream a file to and from disk; copy is server-side between buckets', { skip }, async () => {
  const body = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251))
  const src = join(dir, 'in.bin')
  await writeFile(src, body)
  await store.upload('uploads', 'videos/spike-4', src, 'video/mp4')
  const out = join(dir, 'out.bin')
  const sha256 = await store.download('uploads', 'videos/spike-4', out)
  assert.ok(body.equals(await readFile(out)))
  assert.equal(sha256, createHash('sha256').update(body).digest('hex'), 'the hash is taken on the way')

  await store.copy('uploads', 'videos/spike-4', 'media', 'copy/spike-4.mp4')
  assert.equal(await store.size('media', 'copy/spike-4.mp4'), body.length)
  assert.ok(body.equals(await store.read('media', 'copy/spike-4.mp4')))
})

test('list gives every key in a folder, past a page of 1000, and nothing beside it (a video\'s HLS files, ADR 0021 section 4)', { skip, timeout: 120_000 }, async () => {
  const folder = 'videos/spike-6/'
  const keys = Array.from({ length: 1005 }, (_, i) => `${folder}hls/240/piece-${String(i).padStart(4, '0')}.m4s`)
  for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map((k) => store.write('media', k, Buffer.from('x'), 'video/iso.segment')))
  // A neighbour whose name starts the same. (No object at `videos/spike-6` itself: MinIO keeps objects
  // as files, so one cannot sit beside a folder of the same name. The original is in the other bucket.)
  await store.write('media', 'videos/spike-60/poster.webp', Buffer.from('another video'), 'image/webp')
  assert.deepEqual((await store.list('media', folder)).sort(), keys)
  assert.deepEqual(await store.list('media', 'videos/nothing-here/'), [])
})

test('a public object answers a Range request with 206 and the bytes asked for (what a video player sends)', { skip }, async () => {
  const body = Buffer.from(Array.from({ length: 100_000 }, (_, i) => i % 256))
  await store.write('media', 'range/spike-5.mp4', body, 'video/mp4')
  const res = await fetch(`${endpoint}/${media}/range/spike-5.mp4`, { headers: { range: 'bytes=10-19' } })
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  assert.match(res.headers.get('content-range') ?? '', /^bytes 10-19\/100000$/)
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(body.subarray(10, 20)))
})
