import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { communities, media, members, moderationActions } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { CommunitiesService } from '../communities/communities.service.js'
import { ModerationService, ModerationTargetError, NotAModeratorError } from '../moderation/moderation.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { type ContentScanner, MediaError, type MediaJobs, MediaService } from './media.service.js'
import type { Bucket, ObjectStore } from './object-store.js'

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
  upload(mediaId: string, body: Buffer) {
    this.objects.set(`uploads/community-photos/${mediaId}`, body)
  }
  keys(bucket: Bucket) {
    return [...this.objects.keys()].filter((k) => k.startsWith(`${bucket}/`)).sort()
  }
}

class RecordingJobs implements MediaJobs {
  readonly purged: string[][] = []
  async processPostImage() {}
  async purgeCdn(keys: string[]) {
    this.purged.push(keys)
  }
}

class Scanner implements ContentScanner {
  verdict: 'clear' | 'match' | 'down' = 'clear'
  async scan() {
    if (this.verdict === 'down') throw new Error('scanner offline')
    return this.verdict
  }
}

let store: MemoryStore
let jobs: RecordingJobs
let scanner: Scanner
let service: MediaService
let moderation: ModerationService
let list: CommunitiesService
const [lola, sam, ada, chi] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
let communityId: string

const picture = () => sharp({ create: { width: 900, height: 600, channels: 3, background: '#2a7' } }).jpeg().toBuffer()

/** What the moderator's browser does: ask for a ticket, upload, say it is done. */
async function upload(who: string, slug = 'lagos') {
  const body = await picture()
  const { mediaId } = await service.startCommunityPhotoUpload(who, slug, 'image/jpeg', body.length)
  store.upload(mediaId, body)
  return { mediaId, finish: () => service.finishCommunityPhotoUpload(who, slug, mediaId) }
}

const photoColumn = async () =>
  (await db.select({ id: communities.photoMediaId }).from(communities).where(eq(communities.id, communityId)))[0]!.id
const statusOf = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!.status

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: lola, handle: 'lola' },
    { id: sam, handle: 'sam' },
    { id: ada, handle: 'ada' },
    { id: chi, handle: 'chi' },
  ])
  const [c] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: '' }).returning({ id: communities.id })
  communityId = c!.id
  await db.insert(communities).values({ slug: 'abuja', name: 'Abuja', description: '' })
  store = new MemoryStore()
  jobs = new RecordingJobs()
  scanner = new Scanner()
  service = new MediaService(db, store, jobs, scanner)
  moderation = new ModerationService(db, service)
  list = new CommunitiesService(db)
  await moderation.setSiteModerator('sam', true)
  await moderation.setCommunityModerator('lola', 'lagos', true)
  await moderation.setCommunityModerator('chi', 'abuja', true)
})
after(() => pool.end())

test('a community moderator gives their community a photo, shown in the list and on the page', async () => {
  const { mediaId, finish } = await upload(lola)
  assert.equal(await finish(), `/media/community-photos/${mediaId}`)

  assert.equal(await photoColumn(), mediaId)
  assert.deepEqual(store.keys('media'), [
    `media/community-photos/${mediaId}/256.webp`,
    `media/community-photos/${mediaId}/96.webp`,
  ])
  assert.deepEqual(store.keys('uploads'), [])
  const small = sharp(store.objects.get(`media/community-photos/${mediaId}/96.webp`)!)
  assert.deepEqual([(await small.metadata()).width, (await small.metadata()).height], [96, 96])

  const detail = await list.detail(lola, 'lagos')
  assert.equal(detail!.photo, `/media/community-photos/${mediaId}`)
  assert.equal((await list.list(null)).find((c) => c.slug === 'lagos')!.photo, `/media/community-photos/${mediaId}`)
  assert.equal((await list.list(null)).find((c) => c.slug === 'abuja')!.photo, null)
})

test('only that community\'s moderators and site moderators may change the photo', async () => {
  const body = await picture()
  await assert.rejects(service.startCommunityPhotoUpload(ada, 'lagos', 'image/jpeg', body.length), (e) => e instanceof MediaError && e.code === 'forbidden')
  // Moderating a different community is no use here.
  await assert.rejects(service.startCommunityPhotoUpload(chi, 'lagos', 'image/jpeg', body.length), (e) => e instanceof MediaError && e.code === 'forbidden')
  await assert.rejects(service.startCommunityPhotoUpload(lola, 'nowhere', 'image/jpeg', body.length), (e) => e instanceof MediaError && e.code === 'not_found')
  await assert.rejects(service.removeCommunityPhoto(ada, 'lagos'), (e) => e instanceof MediaError && e.code === 'forbidden')

  // A moderator who lost the role between asking and finishing cannot finish.
  const { finish } = await upload(lola)
  await moderation.setCommunityModerator('lola', 'lagos', false)
  await assert.rejects(finish(), (e) => e instanceof MediaError && e.code === 'forbidden')
  assert.equal(await photoColumn(), null)

  const { finish: bySite } = await upload(sam)
  assert.match(await bySite(), /^\/media\/community-photos\//)

  assert.equal((await list.detail(ada, 'lagos'))!.viewerCanManagePhoto, false)
  assert.equal((await list.detail(null, 'lagos'))!.viewerCanManagePhoto, false)
  assert.equal((await list.detail(chi, 'lagos'))!.viewerCanManagePhoto, false)
  assert.equal((await list.detail(sam, 'lagos'))!.viewerCanManagePhoto, true)
  await moderation.setCommunityModerator('lola', 'lagos', true)
  assert.equal((await list.detail(lola, 'lagos'))!.viewerCanManagePhoto, true)
})

test('replacing the photo deletes the old one; removing goes back to the icon', async () => {
  const first = await upload(lola)
  await first.finish()
  const second = await upload(lola)
  await second.finish()
  assert.equal(await photoColumn(), second.mediaId)
  assert.equal(await statusOf(first.mediaId), 'deleted')
  assert.equal(store.keys('media').length, 2)

  await service.removeCommunityPhoto(lola, 'lagos')
  await service.removeCommunityPhoto(lola, 'lagos') // idempotent
  assert.equal(await photoColumn(), null)
  assert.equal(await statusOf(second.mediaId), 'deleted')
  assert.deepEqual(store.keys('media'), [])
  assert.equal((await list.detail(null, 'lagos'))!.photo, null)
})

test('the upload scanner runs first: a match is never published and a scanner that is down fails closed', async () => {
  scanner.verdict = 'down'
  const down = await upload(lola)
  await assert.rejects(down.finish(), (e) => e instanceof MediaError && e.code === 'scan_unavailable')
  assert.deepEqual(store.keys('media'), [])
  assert.equal(await photoColumn(), null)

  scanner.verdict = 'match'
  const matched = await upload(lola)
  await assert.rejects(matched.finish(), (e) => e instanceof MediaError && e.code === 'blocked')
  assert.equal(await statusOf(matched.mediaId), 'blocked')
  assert.deepEqual(store.keys('media'), [])
  assert.equal(await photoColumn(), null)
})

test('a file that is not an image is refused', async () => {
  const { mediaId } = await service.startCommunityPhotoUpload(lola, 'lagos', 'image/jpeg', 10)
  store.upload(mediaId, Buffer.from('not an image'))
  await assert.rejects(service.finishCommunityPhotoUpload(lola, 'lagos', mediaId), (e) => e instanceof MediaError && e.code === 'not_an_image')
  assert.equal(await photoColumn(), null)
})

test('a site moderator takes a photo down: it leaves public view, is kept privately and is logged', async () => {
  const { mediaId, finish } = await upload(lola)
  await finish()

  await assert.rejects(moderation.removeCommunityPhoto(lola, 'lagos'), NotAModeratorError)
  assert.equal(await photoColumn(), mediaId)

  await moderation.removeCommunityPhoto(sam, 'lagos', 'not the community')
  assert.equal(await photoColumn(), null)
  assert.equal(await statusOf(mediaId), 'quarantined')
  assert.deepEqual(store.keys('media'), [])
  assert.equal(store.keys('uploads').filter((k) => k.includes('quarantine/community-photos')).length, 2)
  assert.equal(jobs.purged.length, 1)
  const [entry] = await db.select().from(moderationActions).where(eq(moderationActions.action, 'remove_community_photo'))
  assert.deepEqual([entry!.actorId, entry!.communityId, entry!.note], [sam, communityId, 'not the community'])

  await assert.rejects(moderation.removeCommunityPhoto(sam, 'lagos'), ModerationTargetError)
})

test('the hourly sweep takes down a community photo nothing uses any more', async () => {
  const { mediaId, finish } = await upload(lola)
  await finish()
  await db.update(communities).set({ photoMediaId: null }).where(eq(communities.id, communityId))
  await service.sweepAbandoned()
  assert.equal(await statusOf(mediaId), 'quarantined')
  assert.deepEqual(store.keys('media'), [])
})
