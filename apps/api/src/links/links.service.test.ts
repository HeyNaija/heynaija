import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { linkPreviews, members, postMentions } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import type { ContentScanner } from '../media/media.service.js'
import type { Bucket, ObjectStore } from '../media/object-store.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { type LinkJobs, LinksService } from './links.service.js'
import { FetchRefused, type Fetched, type GetOptions, type PageFetcher } from './safe-fetch.js'

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
  keys() {
    return [...this.objects.keys()].sort()
  }
}

class RecordingJobs implements LinkJobs {
  readonly queued: string[] = []
  async buildPreview(url: string) {
    this.queued.push(url)
  }
}

/** The web, as a table of address → answer. Anything not listed is a connection error. */
class FakeWeb implements PageFetcher {
  readonly pages = new Map<string, { type: string; body: Buffer | string } | Error>()
  readonly asked: string[] = []
  async get(url: string, _options: GetOptions): Promise<Fetched> {
    this.asked.push(url)
    const answer = this.pages.get(url)
    if (!answer) throw new FetchRefused('no such site')
    if (answer instanceof Error) throw answer
    return { url: new URL(url), contentType: answer.type, body: Buffer.from(answer.body) }
  }
  html(url: string, html: string) {
    this.pages.set(url, { type: 'text/html', body: html })
  }
  image(url: string, body: Buffer, type = 'image/png') {
    this.pages.set(url, { type, body })
  }
}

const picture = (width = 1200, height = 630) =>
  sharp({ create: { width, height, channels: 3, background: '#2a7' } }).png().toBuffer()

const ada = randomUUID()
const bayo = randomUUID()
const STORY = 'https://news.example.com/story'
const story = (extra = '') => `<head><title>The story</title>
  <meta property="og:description" content="What happened &amp; why.">
  <meta property="og:site_name" content="Example News">
  <meta property="og:image" content="https://news.example.com/cover.png">${extra}</head>`

let store: MemoryStore
let jobs: RecordingJobs
let web: FakeWeb
let scanner: ContentScanner
let service: LinksService
let posts: PostsService

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
  store = new MemoryStore()
  jobs = new RecordingJobs()
  web = new FakeWeb()
  scanner = { scan: async () => 'clear' }
  service = new LinksService(db, store, jobs, web, { scan: (b) => scanner.scan(b) })
  posts = new PostsService(db)
})
after(() => pool.end())

const rowOf = async (url = STORY) => (await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)))[0]
const age = (url: string, column: 'fetched_at' | 'requested_at', interval: string) =>
  db.execute(sql`update link_previews set ${sql.raw(column)} = now() - ${sql.raw(`interval '${interval}'`)} where url = ${url}`)

test('asking for a preview queues it once, however many posts link there', async () => {
  await service.request(STORY)
  await service.request(STORY)
  await service.request(STORY)
  assert.deepEqual(jobs.queued, [STORY])
  assert.equal((await rowOf())!.status, 'pending')
})

test('a page becomes a card: title, description, site and a thumbnail kept in our own storage', async () => {
  web.html(STORY, story())
  web.image('https://news.example.com/cover.png', await picture())
  await service.request(STORY)
  await service.buildPreview(STORY)

  const row = (await rowOf())!
  assert.equal(row.status, 'ready')
  assert.deepEqual([row.title, row.description, row.siteName], ['The story', 'What happened & why.', 'Example News'])
  assert.ok(row.imageId)
  assert.deepEqual(store.keys(), [`media/links/${row.imageId}/640.webp`])
  const meta = await sharp(store.objects.get(`media/links/${row.imageId}/640.webp`)!).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 640, 336])
  assert.deepEqual([row.imageWidth, row.imageHeight], [640, 336])
})

test('a picture that cannot be used leaves a card without one', async () => {
  web.html(STORY, story())

  // Missing, then too small to be more than an icon, then not a raster image at all, then blocked.
  const cases: [string, () => void | Promise<void>][] = [
    ['missing', () => {}],
    ['icon', async () => web.image('https://news.example.com/cover.png', await picture(64, 64))],
    ['svg', () => web.image('https://news.example.com/cover.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"/>'), 'image/svg+xml')],
    ['junk', () => web.image('https://news.example.com/cover.png', Buffer.from('not an image'))],
    [
      'blocked',
      async () => {
        web.image('https://news.example.com/cover.png', await picture())
        scanner = { scan: async () => 'match' }
      },
    ],
  ]
  for (const [name, setUp] of cases) {
    await setUp()
    await db.delete(linkPreviews)
    await service.request(STORY)
    await service.buildPreview(STORY)
    const row = (await rowOf())!
    assert.equal(row.status, 'ready', name)
    assert.equal(row.title, 'The story', name)
    assert.equal(row.imageId, null, name)
  }
  assert.deepEqual(store.keys(), [], 'nothing was stored')
})

test('a page that cannot be read, or has nothing to show, leaves no card, and is retried after an hour', async () => {
  for (const setUp of [
    () => {}, // no such site
    () => web.pages.set(STORY, new FetchRefused('private address')),
    () => web.html(STORY, '<html><body>just text</body></html>'),
  ]) {
    setUp()
    await db.delete(linkPreviews)
    jobs.queued.length = 0
    await service.request(STORY)
    await service.buildPreview(STORY)
    assert.equal((await rowOf())!.status, 'failed')

    await service.request(STORY)
    assert.deepEqual(jobs.queued, [STORY], 'not asked for again straight away')
    await age(STORY, 'fetched_at', '2 hours')
    await service.request(STORY)
    assert.deepEqual(jobs.queued, [STORY, STORY], 'asked for again after an hour')
    assert.equal((await rowOf())!.status, 'pending')
  }
})

test('a good preview is looked at again after a week, and keeps showing meanwhile', async () => {
  web.html(STORY, story())
  web.image('https://news.example.com/cover.png', await picture())
  await service.request(STORY)
  await service.buildPreview(STORY)
  const first = (await rowOf())!

  await age(STORY, 'fetched_at', '2 days')
  await service.request(STORY)
  assert.equal(jobs.queued.length, 1, 'still fresh')

  await age(STORY, 'fetched_at', '8 days')
  await service.request(STORY)
  assert.equal(jobs.queued.length, 2)
  assert.equal((await rowOf())!.status, 'ready', 'the old card stays up while it is refreshed')

  // The refresh finds a new picture: the old one is deleted, the new one kept.
  web.image('https://news.example.com/cover.png', await picture(900, 900))
  await service.buildPreview(STORY)
  const second = (await rowOf())!
  assert.notEqual(second.imageId, first.imageId)
  assert.deepEqual(store.keys(), [`media/links/${second.imageId}/640.webp`])

  // A refresh that fails keeps what was there.
  await age(STORY, 'fetched_at', '8 days')
  web.pages.delete(STORY)
  await service.request(STORY)
  await service.buildPreview(STORY)
  const third = (await rowOf())!
  assert.equal(third.status, 'ready')
  assert.equal(third.title, 'The story')
  assert.equal(third.imageId, second.imageId)
})

test('a request that was queued and never finished is made again after ten minutes', async () => {
  await service.request(STORY)
  await age(STORY, 'requested_at', '5 minutes')
  await service.request(STORY)
  assert.equal(jobs.queued.length, 1)
  await age(STORY, 'requested_at', '11 minutes')
  await service.request(STORY)
  assert.equal(jobs.queued.length, 2)
})

test('previews nobody links to or asked for in a week are swept, with their pictures', async () => {
  web.html(STORY, story())
  web.image('https://news.example.com/cover.png', await picture())
  const other = 'https://other.example.org/page'
  web.html(other, story())
  for (const url of [STORY, other]) {
    await service.request(url)
    await service.buildPreview(url)
    await age(url, 'requested_at', '8 days')
  }
  await posts.create(ada, `read ${other}`)

  await service.sweep()
  assert.equal(await rowOf(STORY), undefined)
  assert.ok(await rowOf(other), 'a post still links to it')
  assert.equal(store.keys().length, 1)
})

test('a post with a web address shows it as a link, and its card once the page has been read', async () => {
  const { id, linkUrl } = await posts.create(ada, `big news ${STORY}#top, read it`)
  assert.equal(linkUrl, STORY)

  const before = (await posts.feed(null, 10)).posts[0]!
  assert.deepEqual(before.links, [{ start: 9, length: STORY.length + 4, url: `${STORY}#top` }])
  assert.equal(before.linkPreview, null, 'no card until the page has been read')

  web.html(STORY, story())
  web.image('https://news.example.com/cover.png', await picture())
  await service.request(linkUrl!)
  await service.buildPreview(linkUrl!)

  const after = (await posts.feed(null, 10)).posts[0]!
  const row = (await rowOf())!
  assert.deepEqual(after.linkPreview, {
    url: STORY,
    title: 'The story',
    description: 'What happened & why.',
    siteName: 'Example News',
    image: { src: `/media/links/${row.imageId}`, width: 640, height: 336 },
  })

  // Replies carry them too, and a post that is gone shows neither.
  const reply = await posts.create(bayo, `same: ${STORY}`, { replyTo: id })
  await service.buildPreview(reply.linkUrl!)
  const [shown] = (await posts.replies(null, id, 10))!.replies
  assert.ok(shown && !shown.unavailable)
  assert.equal(shown.linkPreview?.title, 'The story')
  assert.equal(shown.links.length, 1)

  // A post that has been deleted shows neither a link nor a card.
  await posts.remove(bayo, reply.id)
  assert.equal(await posts.post(null, reply.id), null)
})

test('a post without an address has none, and an @handle inside one is not a mention', async () => {
  const plain = await posts.create(ada, 'no address here')
  assert.equal(plain.linkUrl, null)

  const { id } = await posts.create(ada, 'profile https://example.com/people?u=@bayo and @bayo')
  const found = await db.select().from(postMentions).where(eq(postMentions.postId, id))
  assert.equal(found.length, 1, 'only the @bayo outside the address')
  assert.equal(found[0]!.start, 'profile https://example.com/people?u=@bayo and '.length)
})
