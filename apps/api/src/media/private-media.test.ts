import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, media, members, posts, videoDetails, videoRenditions } from '@heynaija/db'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { eq, inArray } from 'drizzle-orm'
import { ExportService } from '../export/export.service.js'
import { ModerationService } from '../moderation/moderation.service.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { MemoryVideoStore } from '../video/memory-video-store.js'
import { DEFAULT_VIDEO_CONFIG } from '../video/video-config.js'
import { master480Key, masterKey, playlistKey, posterKey, videoFolder } from '../video/video-keys.js'
import { VIDEO_STORE, VideoService } from '../video/video.service.js'
import { MediaService, publishedKeys } from './media.service.js'
import { MEDIA_URLS, MediaUrls, signPlaylist, urlWindow } from './media-urls.js'
import { CACHE_CONTROL, S3ObjectStore } from './object-store.js'
import { PrivateMediaController } from './private-media.controller.js'

// Posts marked sensitive (ADR 0020) keep their pictures and video in the private
// bucket and hand them out only by signed URLs (ADR 0025). Every way a mark is set
// or taken off moves the files; every way a post's media is read signs them for
// whoever may see the post and for nobody else; and nothing private is ever
// cacheable by Cloudflare.

const ada = randomUUID() // an adult who posts
const bayo = randomUUID() // an adult reader
const kid = randomUUID() // 15
const sam = randomUUID() // a site moderator
const SITE = 'https://heynaija.test'
// Mid-hour, so URLs made now work until the end of the next hour.
let now = Date.UTC(2026, 10, 7, 14, 30)

/** YYYY-MM-DD for someone `years` old today. */
const born = (years: number) => {
  const today = new Date(Date.now() + 60 * 60 * 1000)
  return new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), Math.min(today.getUTCDate(), 28))).toISOString().slice(0, 10)
}

class Jobs {
  placed: string[] = []
  purged: string[] = []
  async processPostImage() {}
  async processVideo() {}
  async purgeCdn(keys: string[]) {
    this.purged.push(...keys)
  }
  async placePostMedia(postId: string) {
    this.placed.push(postId)
  }
}

let store: MemoryVideoStore
let jobs: Jobs
let urls: MediaUrls
let images: MediaService
let videos: VideoService
let postsService: PostsService
let moderation: ModerationService

before(migrate)
beforeEach(async () => {
  await reset()
  const old = new Date(Date.now() - 30 * 86_400_000)
  await db.insert(members).values([
    { id: ada, handle: 'ada', createdAt: old },
    { id: bayo, handle: 'bayo', createdAt: old },
    { id: kid, handle: 'kid', createdAt: old },
    { id: sam, handle: 'sam', createdAt: old },
  ])
  await db.insert(ageAssurances).values([
    { memberId: ada, band: '18_plus', method: 'self_declared', birthDate: born(30) },
    { memberId: bayo, band: '18_plus', method: 'self_declared', birthDate: born(40) },
    { memberId: kid, band: 'under_18', method: 'self_declared', birthDate: born(15) },
    { memberId: sam, band: '18_plus', method: 'self_declared', birthDate: born(35) },
  ])
  now = Date.UTC(2026, 10, 7, 14, 30)
  store = new MemoryVideoStore()
  jobs = new Jobs()
  urls = new MediaUrls('a-secret-only-the-api-has', SITE, 'https://media.heynaija.test', () => now)
  images = new MediaService(db, store, jobs)
  videos = new VideoService(db, store, jobs, DEFAULT_VIDEO_CONFIG, urls)
  postsService = new PostsService(db, DEFAULT_VIDEO_CONFIG, urls, jobs)
  moderation = new ModerationService(db, images, undefined, undefined, videos, jobs, urls)
  await moderation.setSiteModerator('sam', true)
})
after(() => pool.end())

/** A post image the uploader's job has published: its row and its files in the public bucket. */
const readyImage = async (owner = ada) => {
  const [row] = await db
    .insert(media)
    .values({ ownerId: owner, kind: 'post_image', status: 'ready', contentType: 'image/png', bytes: 100, width: 1200, height: 800, readyAt: new Date() })
    .returning({ id: media.id })
  for (const key of publishedKeys('post_image', row!.id)) store.objects.set(`media/${key}`, Buffer.from(key))
  return row!.id
}

const QUALITY = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-TARGETDURATION:4', '#EXT-X-MAP:URI="init_0.mp4"', '#EXTINF:4.0,', 'piece-000.m4s', '#EXTINF:2.5,', 'piece-001.m4s', '#EXT-X-ENDLIST', ''].join('\n')
const MASTER = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360', '360/index.m3u8', ''].join('\n')

/** A video the worker has published, not yet on a post: its rows and its files in the public bucket. */
const readyVideo = async (owner = ada) => {
  const [row] = await db
    .insert(media)
    .values({ ownerId: owner, kind: 'post_video', status: 'ready', contentType: 'video/mp4', bytes: 1000, width: 640, height: 360, readyAt: new Date() })
    .returning({ id: media.id })
  const id = row!.id
  await db.insert(videoDetails).values({ mediaId: id, durationMs: 6_500, width: 640, height: 360, posterKey: posterKey(id), scanResult: 'clear' })
  await db.insert(videoRenditions).values({ mediaId: id, height: 360, width: 640, bytes: 3000, bitrateKbps: 600 })
  const files: Record<string, string> = {
    [masterKey(id)]: MASTER,
    [master480Key(id)]: MASTER,
    [playlistKey(id, 360)]: QUALITY,
    [`${videoFolder(id)}hls/360/init_0.mp4`]: 'init',
    [`${videoFolder(id)}hls/360/piece-000.m4s`]: 'piece 0',
    [`${videoFolder(id)}hls/360/piece-001.m4s`]: 'piece 1',
    [posterKey(id)]: 'poster',
  }
  for (const [key, body] of Object.entries(files)) store.objects.set(`media/${key}`, Buffer.from(body))
  return { id, keys: Object.keys(files).sort() }
}

/** What the media worker does with each queued move. */
const runPlacements = async () => {
  const queued = jobs.placed.splice(0)
  for (const postId of queued) {
    await images.placePostImages(postId)
    await videos.placePostVideos(postId)
  }
  return queued
}

const servedPrivately = async (id: string) => (await db.select({ p: media.servedPrivately }).from(media).where(eq(media.id, id)))[0]!.p
const inBucket = (bucket: 'media' | 'uploads', prefix: string) => store.keys(bucket).filter((k) => k.startsWith(prefix))
const PRIVATE = /^\/api\/v1\/media\/private\/(\d+)\/([\w-]{43})\/posts\/([0-9a-f-]{36})$/

/** True when `src` is a signed path for this image that works now. */
const signedFor = (src: string, mediaId: string) => {
  const m = PRIVATE.exec(src)
  return Boolean(m && m[3] === mediaId && urls.verify(m[1]!, m[2]!, 'posts', mediaId))
}

// --- Signed URLs ---

test('a signed URL opens one media item, until the end of the next hour, and nothing else', () => {
  const id = randomUUID()
  const src = urls.postImage(id, true)
  const [, expiry, signature] = PRIVATE.exec(src)!
  assert.ok(urls.verify(expiry!, signature!, 'posts', id))
  assert.equal(Number(expiry), Date.UTC(2026, 10, 7, 16) / 1000, 'it runs out at the end of the next whole hour')
  assert.equal(urls.postImage(id, true), src, 'everyone is given the same URL within the hour')

  assert.ok(!urls.verify(expiry!, signature!, 'posts', randomUUID()), 'another image')
  assert.ok(!urls.verify(expiry!, signature!, 'videos', id), 'another folder')
  assert.ok(!urls.verify(String(Number(expiry) + 3600), signature!, 'posts', id), 'a later expiry it was not signed for')
  assert.ok(!urls.verify(expiry!, `${signature!.slice(0, -1)}${signature!.endsWith('A') ? 'B' : 'A'}`, 'posts', id), 'a changed signature')
  assert.ok(!new MediaUrls('another secret', SITE, '/media', () => now).verify(expiry!, signature!, 'posts', id), "another server's secret")

  now = Date.UTC(2026, 10, 7, 16)
  assert.ok(!urls.verify(expiry!, signature!, 'posts', id), 'run out')
  assert.notEqual(urls.postImage(id, true), src, 'a new hour, a new URL')
  assert.equal(urls.postImage(id, false), `/media/posts/${id}`, 'an unmarked image keeps its public path')

  assert.deepEqual(urlWindow(Date.UTC(2026, 10, 7, 14, 59, 59)), { signedAt: new Date(Date.UTC(2026, 10, 7, 14)), expiresAt: new Date(Date.UTC(2026, 10, 7, 16)) })
})

test("a quality's playlist has its init segment and every piece signed, and refuses anything but plain names", async () => {
  const signed = await signPlaylist(QUALITY, async (name) => `https://r2.example/${name}?sig`)
  assert.match(signed, /#EXT-X-MAP:URI="https:\/\/r2\.example\/init_0\.mp4\?sig"/)
  assert.deepEqual(signed.split('\n').filter((l) => l && !l.startsWith('#')), ['https://r2.example/piece-000.m4s?sig', 'https://r2.example/piece-001.m4s?sig'])
  assert.ok(signed.includes('#EXTINF:4.0,') && signed.endsWith('#EXT-X-ENDLIST\n'))
  await assert.rejects(signPlaylist('#EXTM3U\n../../posts/x/640.webp\n', async (n) => n))
  await assert.rejects(signPlaylist('#EXTM3U\nhttps://elsewhere.example/a.m4s\n', async (n) => n))
})

// --- Marking moves the files, and only signed URLs reach them ---

test('a post marked when it is made: its pictures move to the private bucket, the public copies are purged', async () => {
  const image = await readyImage()
  const { id } = await postsService.create(ada, 'the scene on the bridge', { images: [{ id: image, alt: 'the scene' }], sensitive: true })
  assert.deepEqual(jobs.placed, [id], 'the move is queued')
  // Until it runs, adults still see the picture where it is.
  assert.equal((await postsService.post(bayo, id))!.images[0]!.src, `/media/posts/${image}`)

  await runPlacements()
  const keys = publishedKeys('post_image', image)
  assert.deepEqual(inBucket('media', `posts/${image}`), [], 'nothing left in the public bucket')
  assert.deepEqual(inBucket('uploads', `sensitive/posts/${image}`), keys.map((k) => `sensitive/${k}`).sort())
  assert.equal(await servedPrivately(image), true)
  assert.deepEqual(jobs.purged.sort(), [...keys].sort(), 'every public URL is purged from Cloudflare')

  // An adult and the author get a signed path; anyone else gets no post at all.
  for (const viewer of [bayo, ada]) {
    const post = await postsService.post(viewer, id)
    assert.ok(signedFor(post!.images[0]!.src, image), `${viewer === ada ? 'the author' : 'an adult'} gets a working signed path`)
  }
  for (const viewer of [null, kid]) assert.equal(await postsService.post(viewer, id), null)
  for (const viewer of [null, kid]) assert.ok(!JSON.stringify((await postsService.feed(viewer, 20)).posts).includes(image))
})

test("Settings' mark-everything moves a new post's pictures too; an unmarked post's stay public and nothing is queued", async () => {
  const plainImage = await readyImage()
  const plain = await postsService.create(ada, 'market day', { images: [{ id: plainImage, alt: '' }] })
  assert.deepEqual(jobs.placed, [])
  assert.equal((await postsService.post(null, plain.id))!.images[0]!.src, `/media/posts/${plainImage}`, 'the fast public path')

  const textOnly = await postsService.create(ada, 'words, marked', { sensitive: true })
  assert.deepEqual(jobs.placed, [], 'nothing to move for a post with no media')
  assert.ok(textOnly.id)

  await db.update(members).set({ labelPosts: 'author' }).where(eq(members.id, ada))
  const image = await readyImage()
  const { id } = await postsService.create(ada, 'everything I post is marked', { images: [{ id: image, alt: '' }] })
  assert.deepEqual(jobs.placed, [id])
  await runPlacements()
  assert.equal(await servedPrivately(image), true)
  assert.ok(signedFor((await postsService.post(bayo, id))!.images[0]!.src, image))
})

test("the author's menu: marking moves the pictures to private, taking the mark off brings them back", async () => {
  const image = await readyImage()
  const { id } = await postsService.create(ada, 'later regretted', { images: [{ id: image, alt: '' }] })

  assert.equal(await postsService.setAdultLabel(ada, id, true), true)
  assert.deepEqual(await runPlacements(), [id])
  assert.equal(await servedPrivately(image), true)
  assert.deepEqual(inBucket('media', `posts/${image}`), [])
  assert.equal(await postsService.post(null, id), null)

  jobs.purged = []
  assert.equal(await postsService.setAdultLabel(ada, id, false), true)
  assert.deepEqual(await runPlacements(), [id])
  assert.equal(await servedPrivately(image), false)
  assert.deepEqual(inBucket('uploads', 'sensitive/'), [])
  assert.deepEqual(inBucket('media', `posts/${image}`), publishedKeys('post_image', image).sort())
  assert.equal((await postsService.post(null, id))!.images[0]!.src, `/media/posts/${image}`)
  assert.deepEqual(jobs.purged.sort(), publishedKeys('post_image', image).sort(), "purged again, in case a 'not found' was cached")

  // Someone else's post, or a refused mark, queues nothing.
  assert.equal(await postsService.setAdultLabel(bayo, id, true), false)
  assert.deepEqual(jobs.placed, [])
})

test("a moderator's mark moves the files to private, and taking it off moves them back; the queue shows them signed", async () => {
  const image = await readyImage()
  const { id } = await postsService.create(ada, 'graphic footage', { images: [{ id: image, alt: '' }] })
  await moderation.report(bayo, { postId: id }, 'needs_label')
  const [item] = await moderation.queue(sam)
  assert.equal(item!.post!.images[0]!.src, `/media/posts/${image}`)

  await moderation.resolve(sam, item!.id, 'label_post')
  assert.deepEqual(await runPlacements(), [id])
  assert.equal(await servedPrivately(image), true)
  assert.deepEqual(inBucket('media', `posts/${image}`), [])

  await moderation.report(bayo, { postId: id }, 'spam')
  const [again] = await moderation.queue(sam)
  assert.ok(signedFor(again!.post!.images[0]!.src, image), 'a moderator reviewing it gets a signed path')

  await moderation.unlabelPost(sam, id, 'on appeal')
  assert.deepEqual(await runPlacements(), [id])
  assert.equal(await servedPrivately(image), false)
  assert.deepEqual(inBucket('uploads', 'sensitive/'), [])
})

test("a marked video's playlists, pieces and poster all move, and its URLs are signed on the site", async () => {
  const video = await readyVideo()
  const { id } = await postsService.create(ada, 'the crash, filmed', { video: { id: video.id, description: 'a crash' }, sensitive: true })
  assert.equal((await postsService.post(bayo, id))!.video!.posterUrl, `https://media.heynaija.test/${posterKey(video.id)}`)
  await runPlacements()

  assert.deepEqual(inBucket('media', videoFolder(video.id)), [], 'nothing left in the public bucket')
  assert.deepEqual(inBucket('uploads', `sensitive/${videoFolder(video.id)}`), video.keys.map((k) => `sensitive/${k}`))
  assert.deepEqual([...new Set(jobs.purged)].sort(), video.keys)
  assert.equal(await servedPrivately(video.id), true)

  const seen = (await postsService.post(bayo, id))!.video!
  const signed = new RegExp(`^${SITE.replace(/\./g, '\\.')}/api/v1/media/private/(\\d+)/([\\w-]{43})/videos/${video.id}/`)
  for (const url of [seen.posterUrl, seen.playlists.all, seen.playlists.upTo480, seen.renditions[0]!.playlistUrl]) {
    const m = signed.exec(url)
    assert.ok(m && urls.verify(m[1]!, m[2]!, 'videos', video.id), `${url} is signed for this video`)
  }
  assert.equal(seen.playlists.all, `${signed.exec(seen.posterUrl)![0]}hls/master.m3u8`)
  for (const viewer of [null, kid]) assert.equal(await postsService.post(viewer, id), null)

  // The uploader's own status view is signed too.
  assert.ok(signed.test((await videos.status(ada, video.id))!.video!.posterUrl))

  await postsService.setAdultLabel(ada, id, false)
  await runPlacements()
  assert.deepEqual(inBucket('uploads', 'sensitive/'), [])
  assert.deepEqual(inBucket('media', videoFolder(video.id)), video.keys)
  assert.equal((await postsService.post(null, id))!.video!.posterUrl, `https://media.heynaija.test/${posterKey(video.id)}`)
})

test("a quote of a marked post signs the quoted pictures for an adult and shows nobody else anything", async () => {
  const image = await readyImage()
  const { id: marked } = await postsService.create(ada, 'injury photo', { images: [{ id: image, alt: '' }], sensitive: true })
  await runPlacements()
  const { id: quote } = await postsService.create(bayo, 'look at this', { quote: marked })

  const forAdult = (await postsService.post(bayo, quote))!.quote!
  assert.ok(!forAdult.unavailable && signedFor(forAdult.images[0]!.src, image))
  for (const viewer of [null, kid]) {
    const post = await postsService.post(viewer, quote)
    assert.deepEqual(post!.quote, { unavailable: true })
    assert.ok(!JSON.stringify(post).includes(image), 'not even the media ID')
  }
})

// --- Takedowns know the private place ---

test('removing a marked post quarantines its files from the private place; restoring puts them back there; deleting removes them', async () => {
  const image = await readyImage()
  const video = await readyVideo()
  const { id: withImage } = await postsService.create(ada, 'pictures', { images: [{ id: image, alt: '' }], sensitive: true })
  const { id: withVideo } = await postsService.create(ada, 'a video', { video: { id: video.id, description: '' }, sensitive: true })
  await runPlacements()

  for (const postId of [withImage, withVideo]) {
    await moderation.report(bayo, { postId }, 'other')
    const [item] = (await moderation.queue(sam)).filter((r) => r.post?.id === postId)
    await moderation.resolve(sam, item!.id, 'remove_post')
  }
  assert.deepEqual(inBucket('uploads', 'sensitive/'), [], 'out of the private place')
  assert.deepEqual(inBucket('uploads', 'quarantine/').length, publishedKeys('post_image', image).length + video.keys.length)

  for (const postId of [withImage, withVideo]) await moderation.restorePost(sam, postId)
  assert.deepEqual(inBucket('uploads', 'quarantine/'), [])
  assert.equal(inBucket('uploads', 'sensitive/').length, publishedKeys('post_image', image).length + video.keys.length, 'back where its mark says')
  assert.deepEqual(store.keys('media'), [], 'never public on the way')
  assert.equal(await servedPrivately(image), true)
  assert.equal(await servedPrivately(video.id), true)

  await postsService.remove(ada, withImage)
  await images.discardPostImages(withImage)
  await postsService.remove(ada, withVideo)
  await videos.discardPostVideos(withVideo)
  assert.deepEqual(inBucket('uploads', 'sensitive/'), [], 'deleted from the private place')
})

test('the hourly sweep moves files whose place disagrees with their mark: a failed job, or a post marked before this existed', async () => {
  const image = await readyImage()
  const video = await readyVideo()
  const { id: a } = await postsService.create(ada, 'pictures', { images: [{ id: image, alt: '' }] })
  const { id: b } = await postsService.create(ada, 'a video', { video: { id: video.id, description: '' } })
  // Marked without the move, as PR #110's posts were.
  await db.update(posts).set({ adultLabel: 'author' }).where(inArray(posts.id, [a, b]))

  await images.sweepAbandoned()
  await videos.sweepAbandoned()
  assert.equal(await servedPrivately(image), true)
  assert.equal(await servedPrivately(video.id), true)
  assert.deepEqual(store.keys('media'), [])

  // And back, for a mark taken off while the queue was down.
  await db.update(posts).set({ adultLabel: null }).where(inArray(posts.id, [a, b]))
  await images.sweepAbandoned()
  await videos.sweepAbandoned()
  assert.equal(await servedPrivately(image), false)
  assert.deepEqual(inBucket('uploads', 'sensitive/'), [])
})

test("a move storage failed part-way is finished by running it again", async () => {
  const video = await readyVideo()
  const { id } = await postsService.create(ada, 'a video', { video: { id: video.id, description: '' }, sensitive: true })
  store.failOnce('remove', 'piece-001')
  await assert.rejects(runPlacements())
  assert.equal(await servedPrivately(video.id), false, 'the row waits for every file')

  await videos.placePostVideos(id)
  assert.equal(await servedPrivately(video.id), true)
  assert.deepEqual(inBucket('media', videoFolder(video.id)), [])
  assert.equal(inBucket('uploads', 'sensitive/').length, video.keys.length)
})

// --- The data export ---

test("the export signs the author's marked pictures and video, and leaves unmarked ones public", async () => {
  const plainImage = await readyImage()
  const markedImage = await readyImage()
  const video = await readyVideo()
  const { id: plain } = await postsService.create(ada, 'plain', { images: [{ id: plainImage, alt: 'plain' }] })
  const { id: marked } = await postsService.create(ada, 'marked', { images: [{ id: markedImage, alt: 'marked' }], sensitive: true })
  const { id: markedVideo } = await postsService.create(ada, 'marked video', { video: { id: video.id, description: '' }, sensitive: true })
  await runPlacements()

  const data = (await new ExportService(db, null, urls).export(ada, null))!
  const byId = new Map(data.posts.map((p) => [p.id, p]))
  assert.equal(byId.get(plain)!.images[0]!.url, `/media/posts/${plainImage}`)
  assert.ok(signedFor(byId.get(marked)!.images[0]!.url, markedImage))
  const [exported] = byId.get(markedVideo)!.videos
  assert.match(exported!.url, new RegExp(`^${SITE}/api/v1/media/private/\\d+/[\\w-]{43}/videos/${video.id}/hls/master\\.m3u8$`))
  assert.match(exported!.poster, /\/poster\.webp$/)
  assert.ok(data.notes.some((n) => n.includes('marked sensitive')))
})

// --- Serving: the signature is the permission, and nothing is cacheable for everyone ---

const apps: NestFastifyApplication[] = []
after(async () => {
  for (const app of apps) await app.close()
})

const boot = async () => {
  @Module({
    controllers: [PrivateMediaController],
    providers: [
      { provide: MEDIA_URLS, useValue: urls },
      { provide: VIDEO_STORE, useValue: store },
    ],
  })
  class TestModule {}
  const app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false })
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  apps.push(app)
  return app
}

/** A signed URL as the API hands it out, as the API itself sees it (the web app strips `/api`). */
const asApiPath = (url: string) => url.replace(SITE, '').replace(/^\/api/, '')

test('a signed picture or poster is a redirect to storage that only the browser may keep; anything else is not found and kept by nobody', async () => {
  // Real time here: the server checks expiry against its own clock.
  now = Date.now()
  const image = await readyImage()
  const video = await readyVideo()
  await postsService.create(ada, 'pictures', { images: [{ id: image, alt: '' }], sensitive: true })
  await postsService.create(ada, 'a video', { video: { id: video.id, description: '' }, sensitive: true })
  await runPlacements()
  const app = await boot()

  const picture = await app.inject({ method: 'GET', url: `${asApiPath(urls.postImage(image, true))}/640.webp` })
  assert.equal(picture.statusCode, 302)
  assert.match(String(picture.headers.location), new RegExp(`^memory://read/uploads/sensitive/posts/${image}/640\\.webp\\?until=`))
  assert.match(String(picture.headers['cache-control']), /^private, max-age=\d+$/)
  const left = Number(/max-age=(\d+)/.exec(String(picture.headers['cache-control']))![1])
  assert.ok(left > 0 && left <= 7200)

  const still = await app.inject({ method: 'GET', url: `${asApiPath(urls.postImage(image, true))}/still.webp` })
  assert.equal(still.statusCode, 302)

  const videoBase = asApiPath(urls.videoBase(video.id, true))
  const poster = await app.inject({ method: 'GET', url: `${videoBase}/${posterKey(video.id)}` })
  assert.equal(poster.statusCode, 302)
  assert.match(String(poster.headers.location), /^memory:\/\/read\/uploads\/sensitive\/videos\/.*\/poster\.webp/)

  const refused = [
    `${asApiPath(urls.postImage(image, true)).replace(/\/[\w-]{43}\//, `/${'A'.repeat(43)}/`)}/640.webp`, // forged
    `${asApiPath(urls.postImage(randomUUID(), true)).replace(/posts\/[0-9a-f-]+$/, `posts/${image}`)}/640.webp`, // signed for another image
    `${asApiPath(urls.postImage(image, true))}/original`, // not a published file
    `${asApiPath(urls.postImage(image, true))}/..%2F640.webp`,
    `/v1/media/private/1/${'A'.repeat(43)}/posts/${image}/640.webp`, // run out
    `${videoBase}/${videoFolder(video.id)}hls/360/piece-000.m4s`, // pieces only through a signed playlist
  ]
  for (const url of refused) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 404, url)
    assert.equal(res.headers['cache-control'], 'private, no-store', `${url}: not cached, even as a refusal`)
  }
})

test("a marked video's playlists come from the API, every piece signed straight to storage, never cached", async () => {
  now = Date.now()
  const video = await readyVideo()
  const { id } = await postsService.create(ada, 'a video', { video: { id: video.id, description: '' }, sensitive: true })
  await runPlacements()
  const app = await boot()
  const seen = (await postsService.post(bayo, id))!.video!

  const master = await app.inject({ method: 'GET', url: asApiPath(seen.playlists.all) })
  assert.equal(master.statusCode, 200)
  assert.equal(master.body, MASTER, 'its lines stay relative, under the same signature')
  assert.equal(master.headers['content-type'], 'application/vnd.apple.mpegurl')
  assert.equal(master.headers['cache-control'], 'private, no-store')
  assert.equal((await app.inject({ method: 'GET', url: asApiPath(seen.playlists.upTo480) })).statusCode, 200)

  // The player resolves `360/index.m3u8` against the master's address.
  const quality = await app.inject({ method: 'GET', url: asApiPath(new URL('360/index.m3u8', seen.playlists.all).href) })
  assert.equal(quality.statusCode, 200)
  assert.equal(quality.headers['cache-control'], 'private, no-store')
  const lines = quality.body.split('\n')
  assert.ok(lines.some((l) => new RegExp(`^#EXT-X-MAP:URI="memory://read/uploads/sensitive/videos/${video.id}/hls/360/init_0\\.mp4\\?until=`).test(l)))
  assert.deepEqual(
    lines.filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\?until=.*$/, '')),
    ['piece-000.m4s', 'piece-001.m4s'].map((p) => `memory://read/uploads/sensitive/videos/${video.id}/hls/360/${p}`),
  )
  assert.equal(seen.renditions[0]!.playlistUrl, new URL('360/index.m3u8', seen.playlists.all).href, 'the rendition names the same playlist')

  // Unmarked again: the private copies are gone, and the old URLs find nothing.
  await postsService.setAdultLabel(ada, id, false)
  await runPlacements()
  const gone = await app.inject({ method: 'GET', url: asApiPath(seen.playlists.all) })
  assert.equal(gone.statusCode, 404)
  assert.equal(gone.headers['cache-control'], 'private, no-store')
})

test('the private bucket is never cached for everyone, and a copy into it does not carry the public header along', async () => {
  assert.equal(CACHE_CONTROL.media, 'public, max-age=31536000, immutable')
  assert.match(CACHE_CONTROL.uploads, /^private, /)

  const s3 = new S3ObjectStore({ endpoint: 'http://127.0.0.1:1', region: 'us-east-1', accessKeyId: 'k', secretAccessKey: 's', uploadsBucket: 'up', mediaBucket: 'pub' })
  const sent: { name: string; input: Record<string, unknown> }[] = []
  // Stands in for storage: records each command and answers a HEAD with the file's type.
  ;(s3 as unknown as { client: { send: (c: { constructor: { name: string }; input: Record<string, unknown> }) => Promise<unknown> } }).client.send = async (c) => {
    sent.push({ name: c.constructor.name, input: c.input })
    return c.constructor.name === 'HeadObjectCommand' ? { ContentType: 'video/iso.segment' } : {}
  }
  await s3.copy('media', 'videos/v/hls/360/piece-000.m4s', 'uploads', 'sensitive/videos/v/hls/360/piece-000.m4s')
  const copy = sent.find((c) => c.name === 'CopyObjectCommand')!.input
  assert.equal(copy.MetadataDirective, 'REPLACE')
  assert.equal(copy.CacheControl, CACHE_CONTROL.uploads)
  assert.equal(copy.ContentType, 'video/iso.segment')

  await s3.write('uploads', 'sensitive/posts/p/640.webp', Buffer.from('x'), 'image/webp')
  assert.equal(sent.find((c) => c.name === 'PutObjectCommand')!.input.CacheControl, CACHE_CONTROL.uploads)

  const url = await s3.presignRead('uploads', 'sensitive/posts/p/640.webp', urlWindow(Date.UTC(2026, 10, 7, 14, 30)))
  assert.match(url, /\/up\/sensitive\/posts\/p\/640\.webp\?/)
  assert.match(url, /X-Amz-Date=20261107T140000Z/, 'signed at the start of the hour, so the URL is the same all hour')
  assert.match(url, /X-Amz-Expires=7200/)
})
