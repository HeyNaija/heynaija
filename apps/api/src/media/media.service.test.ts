import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { media, members } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { MembersService } from '../members/members.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AVATAR_MAX_BYTES, MediaError, MediaService } from './media.service.js'
import type { Bucket, ObjectStore } from './object-store.js'

// Storage is faked in memory; the image handling under test is real.
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>()
  private k = (bucket: Bucket, key: string) => `${bucket}/${key}`
  async presignUpload(key: string) {
    return `memory://uploads/${key}`
  }
  async size(bucket: Bucket, key: string) {
    return this.objects.get(this.k(bucket, key))?.length ?? null
  }
  async read(bucket: Bucket, key: string) {
    return this.objects.get(this.k(bucket, key))!
  }
  async write(bucket: Bucket, key: string, body: Buffer) {
    this.objects.set(this.k(bucket, key), body)
  }
  async remove(bucket: Bucket, key: string) {
    this.objects.delete(this.k(bucket, key))
  }
  /** What a browser would do with the upload URL. */
  upload(mediaId: string, body: Buffer) {
    this.objects.set(`uploads/avatars/${mediaId}`, body)
  }
  keys(bucket: Bucket) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).sort()
  }
}

let store: MemoryStore
let service: MediaService
const ada = randomUUID()
const bayo = randomUUID()

// A wide photo carrying GPS coordinates, as a phone camera would produce.
const photo = () =>
  sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2a7' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 27/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '3/1 23/1 0/1' } })
    .jpeg()
    .toBuffer()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
  store = new MemoryStore()
  service = new MediaService(db, store)
})
after(() => pool.end())

const avatarOf = async (id: string) => (await db.select().from(members).where(eq(members.id, id)))[0]!.avatarMediaId

test('a photo becomes square WebP variants with its location data removed', async () => {
  const original = await photo()
  assert.ok((await sharp(original).metadata()).exif, 'the test photo should carry EXIF to begin with')

  const { mediaId, uploadUrl } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  assert.match(uploadUrl, /avatars\//)
  store.upload(mediaId, original)
  const path = await service.finishAvatarUpload(ada, mediaId)

  assert.equal(path, `/media/avatars/${mediaId}`)
  assert.equal(await avatarOf(ada), mediaId)
  assert.deepEqual(store.keys('media'), [`media/avatars/${mediaId}/256.webp`, `media/avatars/${mediaId}/96.webp`])
  for (const px of [96, 256]) {
    const meta = await sharp(store.objects.get(`media/avatars/${mediaId}/${px}.webp`)!).metadata()
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', px, px])
    assert.equal(meta.exif, undefined)
  }
  // The raw upload is gone once it has been processed.
  assert.deepEqual(store.keys('uploads'), [])
  assert.equal((await db.select().from(media))[0]!.status, 'ready')
})

test('the avatar shows up on the profile, in search and on posts', async () => {
  const original = await photo()
  const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  store.upload(mediaId, original)
  await service.finishAvatarUpload(ada, mediaId)

  const expected = `/media/avatars/${mediaId}`
  const membersService = new MembersService(db)
  const postsService = new PostsService(db)
  await postsService.create(ada, 'hello')
  await postsService.create(bayo, 'no photo here')

  assert.equal((await membersService.profile(null, 'ada'))!.avatar, expected)
  assert.equal((await membersService.profile(null, 'bayo'))!.avatar, null)
  assert.deepEqual(await membersService.search('ada', 5), [{ handle: 'ada', avatar: expected }])
  const feed = (await postsService.feed(null, 10)).posts
  assert.deepEqual(feed.map((p) => [p.authorHandle, p.authorAvatar]), [
    ['bayo', null],
    ['ada', expected],
  ])
})

test('something that is not an image is rejected and cleaned up', async () => {
  const fake = Buffer.from('<script>alert(1)</script> definitely not a jpeg')
  const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', fake.length)
  store.upload(mediaId, fake)

  await assert.rejects(service.finishAvatarUpload(ada, mediaId), (e: MediaError) => e.code === 'not_an_image')
  assert.equal(await avatarOf(ada), null)
  assert.deepEqual([...store.objects.keys()], [])
  assert.equal((await db.select().from(media))[0]!.status, 'failed')
  // A failed upload cannot be retried into existence.
  await assert.rejects(service.finishAvatarUpload(ada, mediaId), (e: MediaError) => e.code === 'not_found')
})

test('an SVG is refused even when it is labelled as a PNG', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>')
  const { mediaId } = await service.startAvatarUpload(ada, 'image/png', svg.length)
  store.upload(mediaId, svg)
  await assert.rejects(service.finishAvatarUpload(ada, mediaId), (e: MediaError) => e.code === 'not_an_image')
  assert.deepEqual(store.keys('media'), [])
})

test('a file larger than the limit is rejected even if storage let it through', async () => {
  const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', 1000)
  store.upload(mediaId, Buffer.alloc(AVATAR_MAX_BYTES + 1))
  await assert.rejects(service.finishAvatarUpload(ada, mediaId), (e: MediaError) => e.code === 'too_large')
  assert.deepEqual([...store.objects.keys()], [])
})

test('finishing before uploading, or finishing someone else\'s upload, does nothing', async () => {
  const original = await photo()
  const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  await assert.rejects(service.finishAvatarUpload(ada, mediaId), (e: MediaError) => e.code === 'not_uploaded')

  store.upload(mediaId, original)
  await assert.rejects(service.finishAvatarUpload(bayo, mediaId), (e: MediaError) => e.code === 'not_found')
  await assert.rejects(service.finishAvatarUpload(ada, randomUUID()), (e: MediaError) => e.code === 'not_found')
  assert.equal(await avatarOf(bayo), null)
  assert.equal(await avatarOf(ada), null)
})

test('finishing twice gives the same answer without doing the work again', async () => {
  const original = await photo()
  const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  store.upload(mediaId, original)
  const first = await service.finishAvatarUpload(ada, mediaId)
  assert.equal(await service.finishAvatarUpload(ada, mediaId), first)
  assert.equal(store.keys('media').length, 2)
})

test('a new avatar replaces the old one and deletes its files', async () => {
  const upload = async () => {
    const original = await photo()
    const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
    store.upload(mediaId, original)
    await service.finishAvatarUpload(ada, mediaId)
    return mediaId
  }
  const first = await upload()
  const second = await upload()

  assert.equal(await avatarOf(ada), second)
  assert.deepEqual(store.keys('media'), [`media/avatars/${second}/256.webp`, `media/avatars/${second}/96.webp`])
  const rows = await db.select().from(media)
  assert.equal(rows.find((r) => r.id === first)!.status, 'deleted')
  assert.equal(rows.find((r) => r.id === second)!.status, 'ready')
})

test('removing the avatar deletes its files and is safe to repeat', async () => {
  const original = await photo()
  const { mediaId } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  store.upload(mediaId, original)
  await service.finishAvatarUpload(ada, mediaId)

  await service.removeAvatar(ada)
  await service.removeAvatar(ada)
  assert.equal(await avatarOf(ada), null)
  assert.deepEqual([...store.objects.keys()], [])
})

test('uploads that were started and abandoned are cleared when the member starts another', async () => {
  const { mediaId: abandoned } = await service.startAvatarUpload(ada, 'image/jpeg', 10)
  store.upload(abandoned, Buffer.alloc(10))
  await db.update(media).set({ createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(media.id, abandoned))
  const { mediaId: recent } = await service.startAvatarUpload(ada, 'image/jpeg', 10)

  await service.startAvatarUpload(ada, 'image/jpeg', 10)
  const rows = await db.select().from(media)
  assert.equal(rows.find((r) => r.id === abandoned)!.status, 'deleted')
  assert.equal(rows.find((r) => r.id === recent)!.status, 'pending')
  assert.deepEqual(store.keys('uploads'), [])
})
