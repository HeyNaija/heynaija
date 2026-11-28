import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { media, members, posts } from '@heynaija/db'
import { BadRequestException } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { slugParam } from '../http.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { PostsController } from '../posts/posts.controller.js'
import { PostsService, newPost } from '../posts/posts.service.js'
import { GIF_PROVIDERS, GifProviders, gifInputFor } from './gif-providers.js'

// A GIF is a provider and an id on the post, picked in the member's browser: the API never calls the provider.

const ada = randomUUID()
const bayo = randomUUID()
const ID = 'xT9IgzoKnwFNmISR8I'
const giphy = (id = ID, description = '') => ({ provider: 'giphy', id, description })
const schema = newPost(slugParam)
const service = () => new PostsService(db)

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
})
after(() => pool.end())

const issues = (input: unknown, against: z.ZodType = schema) => {
  const result = against.safeParse(input)
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

test('a post can be just a GIF, with an optional description', () => {
  assert.deepEqual(issues({ gif: giphy() }), [])
  const parsed = schema.parse({ gif: giphy(ID, '  a dancing cat ') })
  assert.deepEqual(parsed.gif, { provider: 'giphy', id: ID, description: 'a dancing cat' })
  assert.equal(schema.parse({ gif: { provider: 'giphy', id: ID } }).gif?.description, '')
})

test('a provider the API does not know is refused, whatever it is called', () => {
  for (const provider of ['klipy', 'tenor', 'testgif', 'GIPHY', ' giphy', 'giphy/', '../x', '', 'https://evil.example', 'constructor', '__proto__', 'toString']) {
    assert.deepEqual(issues({ gif: { provider, id: ID } }), ['gif.provider: not a GIF provider HeyNaija knows'], JSON.stringify(provider))
  }
  assert.deepEqual(issues({ gif: { id: ID } }), ['gif.provider: Invalid input: expected string, received undefined'])
})

test('a Giphy id is short and alphanumeric: anything that could change the media URL is refused', () => {
  const hostile = ['', '..', '../x', 'a/b', 'a//b', '//evil.example', 'a.webp', 'a b', 'a?x=1', 'a#b', '%2e%2e', 'a\\b', 'é', 'a'.repeat(33), 'a\nb', 'a-b', 'a_b']
  for (const id of hostile) {
    assert.deepEqual(issues({ gif: giphy(id) }), ['gif.id: a GIPHY id is letters and digits only, up to 32'], JSON.stringify(id))
  }
  assert.deepEqual(issues({ gif: giphy('a'.repeat(32)) }), [])
})

test('a second provider is one more entry: its own id rule applies to it, and Giphy keeps its own', () => {
  const testgif = { label: 'TestGIF', id: /^tg-[0-9]{1,6}$/, idRule: 'a TestGIF id is tg- and up to 6 digits' }
  const both = gifInputFor({ ...GIF_PROVIDERS, testgif })
  assert.deepEqual(both.parse({ provider: 'testgif', id: 'tg-42' }), { provider: 'testgif', id: 'tg-42', description: '' })
  assert.deepEqual(issues({ provider: 'testgif', id: ID }, both), ['id: a TestGIF id is tg- and up to 6 digits'])
  assert.deepEqual(issues({ provider: 'giphy', id: 'tg-42' }, both), ['id: a GIPHY id is letters and digits only, up to 32'])
})

test('a GIF in the read shape, with `alt` for its description, is refused rather than stored without it', () => {
  const message = 'gif: a GIF takes provider, id and description, not alt'
  assert.deepEqual(issues({ gif: { provider: 'giphy', id: ID, alt: 'a dancing cat' } }), [message])
  assert.deepEqual(issues({ gif: { ...giphy(), url: 'https://evil.example/x.gif', width: 1 } }), ['gif: a GIF takes provider, id and description, not url, width'])
})

test('the old `giphy` field is not read: a body with only it is an empty post', () => {
  assert.deepEqual(issues({ giphy: { id: ID } }), ['text: post is empty'])
})

test('a GIF cannot be combined with pictures, a video or a poll', () => {
  const message = 'gif: a post with a GIF cannot also have images, a video or a poll'
  assert.deepEqual(issues({ gif: giphy(), images: [{ id: randomUUID() }] }), [message])
  assert.deepEqual(issues({ gif: giphy(), video: { id: randomUUID() } }), [message])
  assert.deepEqual(issues({ gif: giphy(), text: 'q?', poll: { options: ['a', 'b'] } }), [message])
})

test('a GIF is stored with its provider and read back in feeds, the post and its replies', async () => {
  const { id } = await service().create(ada, '', { gif: giphy(ID, 'a dancing cat') })
  const expected = { provider: 'giphy', id: ID, alt: 'a dancing cat' }
  assert.deepEqual((await service().post(null, id))!.gif, expected)
  assert.deepEqual((await service().feed(null, 10)).posts.find((p) => p.id === id)!.gif, expected)
  const reply = await service().create(bayo, 'lol', { replyTo: id, gif: giphy('abc123') })
  const page = await service().replies(null, id)
  const shown = page!.replies.find((r) => r.id === reply.id)
  assert.ok(shown && !('unavailable' in shown))
  assert.deepEqual(shown.gif, { provider: 'giphy', id: 'abc123', alt: '' })
  assert.deepEqual((await service().post(null, reply.id))!.gif, { provider: 'giphy', id: 'abc123', alt: '' })
})

test('a post from a provider no longer offered still reads back with its tag, for the reader to draw or not', async () => {
  const { id } = await service().create(ada, 'old one', { gif: { provider: 'testgif', id: 'tg-7', description: 'from before' } })
  assert.deepEqual((await service().post(null, id))!.gif, { provider: 'testgif', id: 'tg-7', alt: 'from before' })
})

test('the database refuses half a GIF, or a provider or id outside the shapes any provider uses', async () => {
  const insert = (provider: string | null, id: string | null, alt: string | null = null) =>
    db.execute(sql`insert into posts (author_id, text, gif_provider, gif_id, gif_alt) values (${ada}, 'x', ${provider}, ${id}, ${alt})`)
  const refused = async (provider: string | null, id: string | null, alt: string | null = null) =>
    assert.rejects(insert(provider, id, alt), (err: { cause?: { constraint?: string } }) => {
      assert.equal(err.cause?.constraint, 'posts_gif_check', JSON.stringify([provider, id, alt]))
      return true
    })
  await refused('giphy', null)
  await refused(null, ID)
  await refused(null, null, 'a description with no GIF')
  await refused('Giphy', ID)
  await refused('../x', ID)
  await refused('a'.repeat(21), ID)
  await refused('giphy', '../x')
  await refused('giphy', 'a/b')
  await refused('giphy', 'a'.repeat(65))
  await insert('giphy', ID)
  await insert('klipy', 'Ab_9-z')
  await insert(null, null)
})

test("a post or reply with a GIF is on its author's Media tab, and one without is not", async () => {
  const root = await service().create(bayo, 'root')
  await service().create(ada, 'plain')
  await service().create(ada, 'gif post', { gif: giphy() })
  await service().create(ada, 'gif reply', { replyTo: root.id, gif: giphy() })
  const media = await service().byAuthor(null, ada, 10, undefined, 'media')
  assert.deepEqual(media.posts.map((p) => p.text), ['gif reply', 'gif post'])
})

test('a post with no GIF says null', async () => {
  const { id } = await service().create(ada, 'plain')
  assert.equal((await service().post(null, id))!.gif, null)
})

test('a deleted ancestor stands in as a placeholder without its GIF', async () => {
  const parent = await service().create(ada, 'parent', { gif: giphy(ID, 'secret cat') })
  const reply = await service().create(bayo, 'reply', { replyTo: parent.id })
  await service().remove(ada, parent.id)
  const thread = await service().thread(null, reply.id)
  const ancestor = thread!.ancestors[0]!
  assert.equal(ancestor.deleted, true)
  assert.equal(ancestor.gif, null)
})

test('a quote of a post with a GIF carries the GIF, and a quote of a post with no GIF or video says so', async () => {
  const gifPost = await service().create(ada, '', { gif: giphy(ID, 'a dancing cat') })
  const quoting = await service().create(bayo, 'look', { quote: gifPost.id })
  const quote = (await service().post(null, quoting.id))!.quote
  assert.ok(quote && !quote.unavailable)
  assert.deepEqual([quote.gif, quote.hasVideo], [{ provider: 'giphy', id: ID, alt: 'a dancing cat' }, false])
  const plain = await service().create(ada, 'words only')
  const quotingPlain = await service().create(bayo, 'and this', { quote: plain.id })
  const plainQuote = (await service().post(null, quotingPlain.id))!.quote
  assert.ok(plainQuote && !plainQuote.unavailable)
  assert.deepEqual([plainQuote.gif, plainQuote.hasVideo], [null, false])
})

test('a quote of a post whose ready video is its only content says it has a video', async () => {
  const [videoPost] = await db.insert(posts).values({ authorId: ada, text: '' }).returning({ id: posts.id })
  await db.insert(media).values({ ownerId: ada, kind: 'post_video', status: 'ready', contentType: 'video/mp4', bytes: 1000, width: 640, height: 360, readyAt: new Date(), postId: videoPost!.id, position: 0 })
  const quoting = await service().create(bayo, 'watch', { quote: videoPost!.id })
  const quote = (await service().post(null, quoting.id))!.quote
  assert.ok(quote && !quote.unavailable)
  assert.equal(quote.hasVideo, true)
})

test('a deleted post gives its GIF to no one', async () => {
  const { id } = await service().create(ada, '', { gif: giphy() })
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id))
  assert.equal(await service().post(null, id), null)
})

test('the providers that take new GIFs come from settings, and only known ones', () => {
  assert.equal(new GifProviders(['giphy']).acceptsNew('giphy'), true)
  assert.equal(new GifProviders([]).acceptsNew('giphy'), false)
  assert.equal(new GifProviders(['giphy']).acceptsNew('testgif'), false)
})

const controller = (appEnv: 'production' | 'staging', providers = new GifProviders(['giphy'])) =>
  new PostsController(
    service(),
    {} as never,
    { request: async () => {} } as never,
    { hit: async () => {} } as never,
    new FeatureFlags(db, appEnv),
    providers,
  )
const req = { member: { id: ada, handle: 'ada' } } as never

const refusedWith = (message: string) => (err: unknown) => {
  assert.ok(err instanceof BadRequestException)
  assert.deepEqual(err.getResponse(), { code: 'feature_unavailable', message })
  return true
}

test('with giphyGifs off (production default) a post with a GIF is refused, not stripped', async () => {
  await assert.rejects(controller('production').create(req, { gif: giphy() }), refusedWith('GIFs are not available yet'))
  assert.equal((await db.select().from(posts)).length, 0)
})

test('a GIF from a provider not taking new posts is refused, though the flag is on', async () => {
  await assert.rejects(controller('staging', new GifProviders([])).create(req, { gif: giphy() }), refusedWith('GIFs from GIPHY are not available'))
  assert.equal((await db.select().from(posts)).length, 0)
})

test('POST with the read shape of a GIF is a 400 naming the key, and nothing is stored', async () => {
  await assert.rejects(controller('staging').create(req, { gif: { provider: 'giphy', id: ID, alt: 'a dancing cat' } }), (err: unknown) => {
    assert.ok(err instanceof BadRequestException)
    assert.match(String((err.getResponse() as { message: unknown }).message), /a GIF takes provider, id and description, not alt/)
    return true
  })
  assert.equal((await db.select().from(posts)).length, 0)
})

test('with giphyGifs on and Giphy taking new posts, a post with a GIF is created', async () => {
  const { id } = await controller('staging').create(req, { gif: giphy() })
  assert.deepEqual((await service().post(null, id))!.gif, { provider: 'giphy', id: ID, alt: '' })
})
