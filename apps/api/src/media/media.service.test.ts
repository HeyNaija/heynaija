import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { media, members, notifications, posts, reports } from '@heynaija/db'
import { eq, ne, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { slugParam } from '../http.js'
import { MembersService } from '../members/members.service.js'
import { ModerationService, NotAModeratorError } from '../moderation/moderation.service.js'
import { ImagesNotReadyError, newPost, PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { ANIMATION_MAX_FRAMES, AVATAR_MAX_BYTES, type ContentScanner, MediaError, type MediaJobs, MediaService, POST_IMAGE_MAX_BYTES, type PostImageType } from './media.service.js'
import type { Bucket, ObjectStore } from './object-store.js'

// Storage is faked in memory; the image handling under test is real.
class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>()
  /** Runs while a file is being read, to stage something happening mid-job. */
  duringRead?: () => Promise<unknown>
  private k = (bucket: Bucket, key: string) => `${bucket}/${key}`
  async presignUpload(key: string) {
    return `memory://uploads/${key}`
  }
  async size(bucket: Bucket, key: string) {
    return this.objects.get(this.k(bucket, key))?.length ?? null
  }
  async read(bucket: Bucket, key: string) {
    await this.duringRead?.()
    return this.objects.get(this.k(bucket, key))!
  }
  async write(bucket: Bucket, key: string, body: Buffer) {
    this.objects.set(this.k(bucket, key), body)
  }
  async remove(bucket: Bucket, key: string) {
    this.objects.delete(this.k(bucket, key))
  }
  /** What a browser would do with the upload URL. */
  upload(mediaId: string, body: Buffer, folder = 'avatars') {
    this.objects.set(`uploads/${folder}/${mediaId}`, body)
  }
  keys(bucket: Bucket) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).sort()
  }
}

// The queue is faked too: tests run the job themselves, as the worker would.
class RecordingJobs implements MediaJobs {
  readonly queued: string[] = []
  readonly purged: string[][] = []
  async processPostImage(mediaId: string) {
    this.queued.push(mediaId)
  }
  async purgeCdn(keys: string[]) {
    this.purged.push(keys)
  }
}

let store: MemoryStore
let jobs: RecordingJobs
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
  jobs = new RecordingJobs()
  service = new MediaService(db, store, jobs)
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
  assert.deepEqual(await membersService.search('ada', 5), [{ handle: 'ada', displayName: null, avatar: expected, founder: false }])
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
  assert.deepEqual(jobs.purged, [[`avatars/${mediaId}/96.webp`, `avatars/${mediaId}/256.webp`]])
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

// --- Post images ---

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c63' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '9/1 4/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '7/1 29/1 0/1' } })
    .jpeg()
    .toBuffer()

/** Start, upload and finish, as the browser does; the job has not run yet. */
const uploadPostImage = async (owner: string, body: Buffer, type: PostImageType = 'image/jpeg') => {
  const { mediaId } = await service.startPostImageUpload(owner, type, body.length)
  store.upload(mediaId, body, 'posts')
  assert.equal(await service.finishPostImageUpload(owner, mediaId), 'processing')
  return mediaId
}

const readyPostImage = async (owner: string, body?: Buffer) => {
  const mediaId = await uploadPostImage(owner, body ?? (await picture(800, 600)))
  await service.processPostImage(mediaId)
  return mediaId
}

const statusOf = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!.status

test('a post image is processed by the job: proportions kept, location data removed', async () => {
  const mediaId = await uploadPostImage(ada, await picture(2400, 1600))
  assert.deepEqual(jobs.queued, [mediaId])
  assert.equal(await service.postImageStatus(ada, mediaId), 'processing')
  // Nothing is public until the job has run.
  assert.deepEqual(store.keys('media'), [])

  await service.processPostImage(mediaId)
  assert.equal(await service.postImageStatus(ada, mediaId), 'ready')
  assert.deepEqual(store.keys('media'), [`media/posts/${mediaId}/1600.webp`, `media/posts/${mediaId}/640.webp`])
  for (const [px, w, h] of [
    [640, 640, 427],
    [1600, 1600, 1067],
  ]) {
    const meta = await sharp(store.objects.get(`media/posts/${mediaId}/${px}.webp`)!).metadata()
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', w, h])
    assert.equal(meta.exif, undefined)
  }
  assert.deepEqual(store.keys('uploads'), [])
  const [row] = await db.select().from(media).where(eq(media.id, mediaId))
  assert.deepEqual([row!.width, row!.height], [1600, 1067])

  // Running the job again (a retry) changes nothing.
  await service.processPostImage(mediaId)
  assert.equal(store.keys('media').length, 2)
})

test('a small post image is never enlarged', async () => {
  const mediaId = await readyPostImage(ada, await picture(300, 200))
  for (const px of [640, 1600]) {
    const meta = await sharp(store.objects.get(`media/posts/${mediaId}/${px}.webp`)!).metadata()
    assert.deepEqual([meta.width, meta.height], [300, 200])
  }
})

test('a post image that is not an image fails in the job and cannot be retried', async () => {
  const mediaId = await uploadPostImage(ada, Buffer.from('GIF89a but really a script'))
  await service.processPostImage(mediaId)
  assert.equal(await service.postImageStatus(ada, mediaId), 'failed')
  assert.deepEqual([...store.objects.keys()], [])
  await assert.rejects(service.finishPostImageUpload(ada, mediaId), (e: MediaError) => e.code === 'not_found')
})

test('a post image over the limit is refused before it is queued', async () => {
  const { mediaId } = await service.startPostImageUpload(ada, 'image/jpeg', 1000)
  store.upload(mediaId, Buffer.alloc(POST_IMAGE_MAX_BYTES + 1), 'posts')
  await assert.rejects(service.finishPostImageUpload(ada, mediaId), (e: MediaError) => e.code === 'too_large')
  assert.deepEqual(jobs.queued, [])
  assert.deepEqual([...store.objects.keys()], [])
})

test("someone else's post image is invisible to you", async () => {
  const mediaId = await uploadPostImage(ada, await picture(400, 400))
  assert.equal(await service.postImageStatus(bayo, mediaId), null)
  await assert.rejects(service.finishPostImageUpload(bayo, mediaId), (e: MediaError) => e.code === 'not_found')
})

test('images appear on the post in order, with their descriptions', async () => {
  const postsService = new PostsService(db)
  const first = await readyPostImage(ada, await picture(1200, 800))
  const second = await readyPostImage(ada, await picture(600, 900))
  const { id } = await postsService.create(ada, 'Lagos at dusk', {
    images: [
      { id: second, alt: 'A tall photo' },
      { id: first, alt: 'Third Mainland Bridge' },
    ],
  })

  const thread = await postsService.thread(null, id)
  assert.deepEqual(thread!.post.images, [
    { src: `/media/posts/${second}`, alt: 'A tall photo', width: 600, height: 900, animated: false },
    { src: `/media/posts/${first}`, alt: 'Third Mainland Bridge', width: 1200, height: 800, animated: false },
  ])
  assert.deepEqual((await postsService.feed(null, 10)).posts[0]!.images.length, 2)
})

test('a post can be only images, but not nothing at all', () => {
  const schema = newPost(slugParam)
  const image = { id: randomUUID(), alt: '' }
  assert.equal(schema.safeParse({ text: '', images: [image] }).success, true)
  assert.equal(schema.safeParse({ text: '   ', images: [] }).success, false)
  assert.equal(schema.safeParse({}).success, false)
  assert.equal(schema.safeParse({ text: 'hi', images: [1, 2, 3, 4, 5].map(() => ({ id: randomUUID() })) }).success, false)
  assert.equal(schema.safeParse({ text: 'hi', images: [image, image] }).success, false)
})

test('a post cannot use an image that is still processing, used already, or not yours', async () => {
  const postsService = new PostsService(db)
  const processing = await uploadPostImage(ada, await picture(400, 400))
  const ready = await readyPostImage(ada)
  const bayos = await readyPostImage(bayo)

  const attempt = (images: string[]) =>
    postsService.create(ada, 'with pictures', { images: images.map((id) => ({ id, alt: '' })) })
  await assert.rejects(attempt([ready, processing]), ImagesNotReadyError)
  await assert.rejects(attempt([bayos]), ImagesNotReadyError)
  // The failed attempts left nothing behind: no post, and the ready image still free.
  assert.equal((await db.select().from(posts)).length, 0)

  await attempt([ready])
  await assert.rejects(attempt([ready]), ImagesNotReadyError)
  assert.equal((await db.select().from(posts)).length, 1)
})

test("deleting a post deletes its images; a moderator's removal only hides them", async () => {
  const postsService = new PostsService(db)
  const kept = await readyPostImage(ada)
  const gone = await readyPostImage(ada)
  const { id: removed } = await postsService.create(ada, 'removed by a moderator', { images: [{ id: kept, alt: '' }] })
  const { id: deleted } = await postsService.create(ada, 'deleted by its author', { images: [{ id: gone, alt: '' }] })

  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, removed))
  assert.equal(await postsService.remove(ada, deleted), true)
  await service.discardPostImages(deleted)

  assert.equal(await statusOf(gone), 'deleted')
  assert.deepEqual(store.keys('media'), [`media/posts/${kept}/1600.webp`, `media/posts/${kept}/640.webp`])
  // Out of Cloudflare's cache too, which would otherwise serve the files for a year.
  assert.deepEqual(jobs.purged, [[`posts/${gone}/640.webp`, `posts/${gone}/1600.webp`, `posts/${gone}/still.webp`]])
  assert.deepEqual((await postsService.byAuthor(null, ada, 10)).posts, [])

  // Restoring the removed post brings its image back.
  await db.update(posts).set({ removedAt: null }).where(eq(posts.id, removed))
  assert.deepEqual((await postsService.thread(null, removed))!.post.images.map((i) => i.src), [`/media/posts/${kept}`])
})

test('images never put on a post are swept after an hour, by the hourly job too', async () => {
  const postsService = new PostsService(db)
  const unused = await readyPostImage(ada)
  const used = await readyPostImage(ada)
  const fresh = await readyPostImage(bayo)
  await postsService.create(ada, 'one picture', { images: [{ id: used, alt: '' }] })
  const anHourAgo = new Date(Date.now() - 61 * 60 * 1000)
  await db.update(media).set({ readyAt: anHourAgo, createdAt: anHourAgo }).where(ne(media.id, fresh))

  // Everyone's, as the hourly job does: no member given.
  await service.sweepAbandoned()
  assert.equal(await statusOf(unused), 'deleted')
  assert.equal(await statusOf(used), 'ready')
  assert.equal(await statusOf(fresh), 'ready')
  assert.deepEqual(
    store.keys('media').filter((k) => k.includes(unused)),
    [],
  )
})

test('an image abandoned while the job was running does not stay public', async () => {
  const mediaId = await uploadPostImage(ada, await picture(400, 300))
  store.duringRead = () => db.update(media).set({ status: 'deleted' }).where(eq(media.id, mediaId))
  await service.processPostImage(mediaId)
  assert.equal(await statusOf(mediaId), 'deleted')
  assert.deepEqual(store.keys('media'), [])
})

// --- Taking images down, and scanning ---

const sam = randomUUID() // site moderator

const withModerator = async () => {
  await db.insert(members).values({ id: sam, handle: 'sam' })
  const moderation = new ModerationService(db, service)
  await moderation.setSiteModerator('sam', true)
  return moderation
}

const reportOf = async (where: ReturnType<typeof eq>) => (await db.select().from(reports).where(where))[0]!

test("a moderator's removal moves a post's images out of public view, and a restore brings them back", async () => {
  const moderation = await withModerator()
  const postsService = new PostsService(db)
  const image = await readyPostImage(bayo)
  const { id: post } = await postsService.create(bayo, 'look', { images: [{ id: image, alt: '' }] })
  await moderation.report(ada, { postId: post }, 'illegal')
  await moderation.resolve(sam, (await reportOf(eq(reports.postId, post))).id, 'remove_post')

  assert.equal(await statusOf(image), 'quarantined')
  assert.deepEqual(store.keys('media'), [])
  // Kept privately, as evidence and so the decision can be undone.
  assert.deepEqual(store.keys('uploads'), [
    `uploads/quarantine/posts/${image}/1600.webp`,
    `uploads/quarantine/posts/${image}/640.webp`,
  ])
  // And dropped from Cloudflare's cache, which would otherwise serve it for a year.
  assert.deepEqual(jobs.purged, [[`posts/${image}/640.webp`, `posts/${image}/1600.webp`, `posts/${image}/still.webp`]])

  await moderation.restorePost(sam, post)
  assert.equal(await statusOf(image), 'ready')
  assert.deepEqual(store.keys('uploads'), [])
  assert.deepEqual((await postsService.thread(null, post))!.post.images.map((i) => i.src), [`/media/posts/${image}`])
})

test('the hourly sweep takes down images of removed posts that are still public', async () => {
  const postsService = new PostsService(db)
  const image = await readyPostImage(bayo)
  const { id: post } = await postsService.create(bayo, 'look', { images: [{ id: image, alt: '' }] })
  // Removed, but the files were never moved (storage failed at the time).
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, post))

  await service.sweepAbandoned()
  assert.equal(await statusOf(image), 'quarantined')
  assert.deepEqual(store.keys('media'), [])
})

test('a site moderator can remove a profile photo, or clear a name and bio, without suspending', async () => {
  const moderation = await withModerator()
  const original = await photo()
  const { mediaId } = await service.startAvatarUpload(bayo, 'image/jpeg', original.length)
  store.upload(mediaId, original)
  await service.finishAvatarUpload(bayo, mediaId)
  await db.update(members).set({ displayName: 'Real Bank Support', bio: 'DM me your PIN' }).where(eq(members.id, bayo))

  await moderation.report(ada, { handle: 'bayo' }, 'scam')
  const [item] = await moderation.queue(sam)
  assert.deepEqual(item!.member, {
    handle: 'bayo',
    active: true,
    displayName: 'Real Bank Support',
    bio: 'DM me your PIN',
    avatar: `/media/avatars/${mediaId}`,
  })

  await moderation.resolve(sam, item!.id, 'remove_avatar')
  assert.equal(await avatarOf(bayo), null)
  assert.equal(await statusOf(mediaId), 'quarantined')
  assert.deepEqual(store.keys('media'), [])

  const chi = randomUUID()
  await db.insert(members).values({ id: chi, handle: 'chi' })
  await moderation.report(chi, { handle: 'bayo' }, 'scam')
  const [second] = await moderation.queue(sam)
  await moderation.resolve(sam, second!.id, 'clear_profile')
  const [row] = await db.select().from(members).where(eq(members.id, bayo))
  assert.deepEqual([row!.displayName, row!.bio, row!.active], [null, '', true])

  const told = await db.select().from(notifications).where(eq(notifications.recipientId, bayo))
  assert.deepEqual(told.map((n) => n.kind).sort(), ['avatar_removed', 'profile_cleared'])
})

test('community moderators cannot change profiles, and a missing photo cannot be removed', async () => {
  const moderation = await withModerator()
  const lola = randomUUID()
  await db.insert(members).values({ id: lola, handle: 'lola' })
  await db.execute(sql`insert into communities (slug, name, description) values ('lagos', 'Lagos', '')`)
  await moderation.setCommunityModerator('lola', 'lagos', true)
  await moderation.report(ada, { handle: 'bayo' }, 'scam')
  const report = await reportOf(eq(reports.reporterId, ada))

  await assert.rejects(moderation.resolve(lola, report.id, 'clear_profile'), NotAModeratorError)
  await assert.rejects(moderation.resolve(sam, report.id, 'remove_avatar'), /no profile photo/)
})

// A scanner that flags everything, standing in for a real hash match.
class MatchEverything implements ContentScanner {
  async scan() {
    return 'match' as const
  }
}

test('an upload the scanner matches is never published, and the original is kept privately', async () => {
  const alerts: string[] = []
  service = new MediaService(db, store, jobs, new MatchEverything(), { alert: async (subject) => void alerts.push(subject) })
  const mediaId = await uploadPostImage(ada, await picture(800, 600))
  await service.processPostImage(mediaId)

  assert.equal(await statusOf(mediaId), 'blocked')
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), [`uploads/quarantine/originals/posts/${mediaId}`])
  // The uploader sees an ordinary failure, and cannot use it on a post.
  assert.equal(await service.postImageStatus(ada, mediaId), 'failed')
  await assert.rejects(
    new PostsService(db).create(ada, 'x', { images: [{ id: mediaId, alt: '' }] }),
    /missing, still processing/,
  )

  const original = await photo()
  const { mediaId: avatar } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  store.upload(avatar, original)
  await assert.rejects(service.finishAvatarUpload(ada, avatar), (e: MediaError) => e.code === 'blocked')
  assert.equal(await avatarOf(ada), null)
  assert.equal(await statusOf(avatar), 'blocked')

  // Each match puts the account in front of site moderators and alerts a person.
  const filed = await db.select().from(reports)
  assert.deepEqual(filed.map((r) => [r.reporterId, r.memberId, r.postId, r.reason]), [
    [null, ada, null, 'illegal'],
    [null, ada, null, 'illegal'],
  ])
  assert.match(filed[0]!.details, new RegExp(mediaId))
  assert.equal(alerts.length, 2)
  const moderation = await withModerator()
  const queue = await moderation.queue(sam)
  assert.deepEqual(queue.map((i) => [i.reporterHandle, i.member?.handle]), [[null, 'ada'], [null, 'ada']])
})

// A scanner whose service is down.
class Unreachable implements ContentScanner {
  async scan(): Promise<'clear'> {
    throw new Error('connect ETIMEDOUT')
  }
}

test('when the scanner cannot answer, nothing is published and the upload can be tried again', async () => {
  service = new MediaService(db, store, jobs, new Unreachable())
  const mediaId = await uploadPostImage(ada, await picture(800, 600))
  // The job throws, so the queue retries it later.
  await assert.rejects(service.processPostImage(mediaId), (e: MediaError) => e.code === 'scan_unavailable')
  assert.equal(await statusOf(mediaId), 'processing')
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), [`uploads/posts/${mediaId}`])

  const original = await photo()
  const { mediaId: avatar } = await service.startAvatarUpload(ada, 'image/jpeg', original.length)
  store.upload(avatar, original)
  await assert.rejects(service.finishAvatarUpload(ada, avatar), (e: MediaError) => e.code === 'scan_unavailable')
  assert.equal(await avatarOf(ada), null)
  assert.deepEqual(store.keys('media'), [])

  // Back up: the same uploads go through.
  service = new MediaService(db, store, jobs)
  await service.processPostImage(mediaId)
  assert.equal(await statusOf(mediaId), 'ready')
  assert.equal(await service.finishAvatarUpload(ada, avatar), `/media/avatars/${avatar}`)
  assert.equal(await db.select().from(reports).then((r) => r.length), 0)
})

test('deleting a reported post keeps its images privately for the moderator', async () => {
  const moderation = await withModerator()
  const postsService = new PostsService(db)
  const image = await readyPostImage(bayo)
  const { id: post } = await postsService.create(bayo, 'evidence', { images: [{ id: image, alt: '' }] })
  await moderation.report(ada, { postId: post }, 'illegal')

  await postsService.remove(bayo, post)
  await service.discardPostImages(post)
  assert.equal(await statusOf(image), 'quarantined')
  assert.deepEqual(store.keys('media'), [])
  assert.equal(store.keys('uploads').length, 2)
})

// A GIF of `frames` solid-colour frames, as a phone's keyboard or a meme site would hand over.
const animatedGif = async (frames = 3, width = 120, height = 80) =>
  sharp(
    await Promise.all(
      Array.from({ length: frames }, (_, i) =>
        sharp({ create: { width, height, channels: 3, background: { r: (i * 80) % 256, g: 120, b: 200 } } }).png().toBuffer(),
      ),
    ),
    { join: { animated: true } },
  )
    .gif({ delay: Array.from({ length: frames }, () => 100), loop: 0 })
    .toBuffer()

test('a GIF becomes an animated WebP at our sizes, with a still of its first frame', async () => {
  const gif = await animatedGif(4, 1000, 500)
  assert.equal((await sharp(gif, { animated: true }).metadata()).pages, 4)
  const mediaId = await uploadPostImage(ada, gif, 'image/gif')
  await service.processPostImage(mediaId)

  assert.equal(await service.postImageStatus(ada, mediaId), 'ready')
  assert.deepEqual(store.keys('media'), [`media/posts/${mediaId}/1600.webp`, `media/posts/${mediaId}/640.webp`, `media/posts/${mediaId}/still.webp`])
  for (const [name, w, h, frames] of [
    ['640', 640, 320, 4],
    ['1600', 1000, 500, 4], // not enlarged: the large size is the GIF's own
  ] as const) {
    const meta = await sharp(store.objects.get(`media/posts/${mediaId}/${name}.webp`)!, { animated: true }).metadata()
    assert.deepEqual([meta.format, meta.width, meta.pageHeight, meta.pages], ['webp', w, h, frames], name)
  }
  const still = await sharp(store.objects.get(`media/posts/${mediaId}/still.webp`)!, { animated: true }).metadata()
  assert.deepEqual([still.format, still.width, still.height, still.pages ?? 1], ['webp', 640, 320, 1])

  const [row] = await db.select().from(media).where(eq(media.id, mediaId))
  assert.deepEqual([row!.animated, row!.width, row!.height], [true, 1000, 500])
  assert.deepEqual(store.keys('uploads'), [])
})

test('a GIF already small is encoded once and used for both sizes', async () => {
  const mediaId = await readyPostImage(ada, await animatedGif(3, 200, 100))
  // (readyPostImage uploads as a JPEG: the file's bytes decide what it is, not its label)
  const small = store.objects.get(`media/posts/${mediaId}/640.webp`)!
  const large = store.objects.get(`media/posts/${mediaId}/1600.webp`)!
  assert.ok(small.equals(large))
  assert.equal((await sharp(small, { animated: true }).metadata()).pages, 3)
})

test('a GIF with one frame is an ordinary image: no animation, no still', async () => {
  const gif = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2a7' } }).gif().toBuffer()
  const mediaId = await readyPostImage(ada, gif)
  assert.deepEqual(store.keys('media'), [`media/posts/${mediaId}/1600.webp`, `media/posts/${mediaId}/640.webp`])
  assert.equal((await db.select().from(media).where(eq(media.id, mediaId)))[0]!.animated, false)
})

test('a GIF that is too long, or too large for all its frames, is refused by the job', async () => {
  const tooLong = await uploadPostImage(ada, await animatedGif(ANIMATION_MAX_FRAMES + 1, 16, 16), 'image/gif')
  await service.processPostImage(tooLong)
  assert.equal(await service.postImageStatus(ada, tooLong), 'failed')

  // 400 × 400 × 260 frames is 41.6 million pixels held at once.
  const tooBig = await uploadPostImage(ada, await animatedGif(260, 400, 400), 'image/gif')
  await service.processPostImage(tooBig)
  assert.equal(await service.postImageStatus(ada, tooBig), 'failed')
  assert.deepEqual(store.keys('media'), [])
  assert.deepEqual(store.keys('uploads'), [])
})

test('a profile photo cannot be a GIF, whatever it is labelled as', async () => {
  const gif = await animatedGif()
  const { mediaId } = await service.startAvatarUpload(ada, 'image/png', gif.length)
  store.upload(mediaId, gif)
  await assert.rejects(service.finishAvatarUpload(ada, mediaId), (e: MediaError) => e.code === 'not_an_image')
  assert.deepEqual(store.keys('media'), [])
})

test('a GIF is on the post as animated, and its still goes with it when the post is taken down and put back', async () => {
  const postsService = new PostsService(db)
  const image = await readyPostImage(bayo, await animatedGif())
  const { id: post } = await postsService.create(bayo, 'funny', { images: [{ id: image, alt: 'A wobbling box' }] })
  const shown = (await postsService.thread(null, post))!.post.images
  assert.deepEqual(shown, [{ src: `/media/posts/${image}`, alt: 'A wobbling box', width: 120, height: 80, animated: true }])

  await service.quarantinePostImages(post)
  assert.deepEqual(store.keys('media'), [])
  assert.equal(store.keys('uploads').length, 3, 'both sizes and the still are kept privately')
  await service.releasePostImages(post)
  assert.equal(store.keys('media').length, 3)
  assert.equal(store.keys('uploads').length, 0)

  await postsService.remove(bayo, post)
  await service.discardPostImages(post)
  assert.deepEqual(store.keys('media'), [], 'deleting the post deletes the still too')
})
