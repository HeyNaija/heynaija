import { readFile, writeFile } from 'node:fs/promises'
import type { Bucket, UploadedPart, VideoStore } from '../media/object-store.js'

/**
 * A VideoStore in memory, for tests of the video service and worker. A part URL
 * is `memory://part/<uploadId>/<n>/<bytes>`; `putPart` is what the browser does with it.
 */
export class MemoryVideoStore implements VideoStore {
  readonly objects = new Map<string, Buffer>()
  readonly uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>()
  readonly aborted: string[] = []
  private n = 0
  private k = (bucket: Bucket, key: string) => `${bucket}/${key}`

  async presignUpload(key: string) {
    return `memory://uploads/${key}`
  }
  async size(bucket: Bucket, key: string) {
    return this.objects.get(this.k(bucket, key))?.length ?? null
  }
  async read(bucket: Bucket, key: string) {
    const body = this.objects.get(this.k(bucket, key))
    if (!body) throw new Error(`no such object ${bucket}/${key}`)
    return body
  }
  async write(bucket: Bucket, key: string, body: Buffer) {
    this.objects.set(this.k(bucket, key), body)
  }
  async remove(bucket: Bucket, key: string) {
    this.objects.delete(this.k(bucket, key))
  }
  async createMultipart(key: string) {
    const id = `upload-${++this.n}`
    this.uploads.set(id, { key, parts: new Map() })
    return id
  }
  async presignPart(_key: string, uploadId: string, partNumber: number, bytes: number) {
    return `memory://part/${uploadId}/${partNumber}/${bytes}`
  }
  async listParts(_key: string, uploadId: string): Promise<UploadedPart[]> {
    const u = this.uploads.get(uploadId)
    if (!u) throw new Error('NoSuchUpload')
    return [...u.parts].sort(([a], [b]) => a - b).map(([partNumber, body]) => ({ partNumber, size: body.length, etag: `"etag-${partNumber}"` }))
  }
  async completeMultipart(key: string, uploadId: string, parts: { partNumber: number }[]) {
    const u = this.uploads.get(uploadId)
    if (!u) throw new Error('NoSuchUpload')
    this.objects.set(this.k('uploads', key), Buffer.concat(parts.map((p) => u.parts.get(p.partNumber)!)))
    this.uploads.delete(uploadId)
  }
  async abortMultipart(_key: string, uploadId: string) {
    this.uploads.delete(uploadId)
    this.aborted.push(uploadId)
  }
  async download(bucket: Bucket, key: string, path: string) {
    await writeFile(path, await this.read(bucket, key))
  }
  async upload(bucket: Bucket, key: string, path: string) {
    this.objects.set(this.k(bucket, key), await readFile(path))
  }
  async copy(from: Bucket, fromKey: string, to: Bucket, toKey: string) {
    this.objects.set(this.k(to, toKey), await this.read(from, fromKey))
  }

  /** What a browser does with a part URL. */
  putPart(uploadId: string, partNumber: number, body: Buffer) {
    this.uploads.get(uploadId)!.parts.set(partNumber, body)
  }
  /** Puts a finished file where the original would be, as if the upload had completed. */
  putOriginal(key: string, body: Buffer) {
    this.objects.set(this.k('uploads', key), body)
  }
  async putFile(bucket: Bucket, key: string, path: string) {
    this.objects.set(this.k(bucket, key), await readFile(path))
  }
  keys(bucket: Bucket) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1)).sort()
  }
}
