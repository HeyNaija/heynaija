import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, posts } from '@heynaija/db'
import { BadRequestException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { slugParam } from '../http.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { PostsController } from './posts.controller.js'
import { PostsService, newPost } from './posts.service.js'

// A GIF from Giphy is one id on the post, picked in the member's browser: the API never calls Giphy.

const ada = randomUUID()
const bayo = randomUUID()
const ID = 'xT9IgzoKnwFNmISR8I'
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

const issues = (input: unknown) => {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
}

test('a post can be just a Giphy GIF, with an optional description', () => {
  assert.deepEqual(issues({ giphy: { id: ID, description: '' } }), [])
  const parsed = schema.parse({ giphy: { id: ID, description: '  a dancing cat ' } })
  assert.deepEqual(parsed.giphy, { id: ID, description: 'a dancing cat' })
  assert.equal(schema.parse({ giphy: { id: ID, description: '' } }).giphy?.description, '')
})

test('a Giphy id is short and alphanumeric: anything that could change the media URL is refused', () => {
  const hostile = ['', '..', '../x', 'a/b', 'a//b', '//evil.example', 'a.webp', 'a b', 'a?x=1', 'a#b', '%2e%2e', 'a\\b', 'é', 'a'.repeat(33), 'a\nb']
  for (const id of hostile) {
    assert.deepEqual(issues({ giphy: { id } }), [`giphy.id: a Giphy id is letters and digits only, up to 32`], JSON.stringify(id))
  }
  assert.deepEqual(issues({ giphy: { id: 'a'.repeat(32) } }), [])
})

test('a GIF cannot be combined with pictures, a video or a poll', () => {
  const image = { id: randomUUID() }
  assert.deepEqual(issues({ giphy: { id: ID }, images: [image] }), ['giphy: a post with a Giphy GIF cannot also have images, a video or a poll'])
  assert.deepEqual(issues({ giphy: { id: ID }, video: { id: randomUUID() } }), ['giphy: a post with a Giphy GIF cannot also have images, a video or a poll'])
  assert.deepEqual(issues({ giphy: { id: ID }, text: 'q?', poll: { options: ['a', 'b'] } }), ['giphy: a post with a Giphy GIF cannot also have images, a video or a poll'])
})

test('a GIF is stored on the post and read back in feeds, the post and its replies', async () => {
  const { id } = await service().create(ada, '', { giphy: { id: ID, description: 'a dancing cat' } })
  assert.deepEqual((await service().post(null, id))!.giphy, { id: ID, alt: 'a dancing cat' })
  assert.deepEqual((await service().feed(null, 10)).posts.find((p) => p.id === id)!.giphy, { id: ID, alt: 'a dancing cat' })
  const reply = await service().create(bayo, 'lol', { replyTo: id, giphy: { id: 'abc123', description: '' } })
  const page = await service().replies(null, id)
  const shown = page!.replies.find((r) => r.id === reply.id)
  assert.ok(shown && !('unavailable' in shown))
  assert.deepEqual(shown.giphy, { id: 'abc123', alt: '' })
  assert.equal((await service().post(null, reply.id))!.giphy?.id, 'abc123')
})

test('a post with no GIF says null', async () => {
  const { id } = await service().create(ada, 'plain')
  assert.equal((await service().post(null, id))!.giphy, null)
})

test('a deleted post gives its GIF to no one', async () => {
  const { id } = await service().create(ada, '', { giphy: { id: ID, description: '' } })
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id))
  assert.equal(await service().post(null, id), null)
})

const controller = (appEnv: 'production' | 'staging') =>
  new PostsController(
    service(),
    {} as never,
    { request: async () => {} } as never,
    { hit: async () => {} } as never,
    new FeatureFlags(db, appEnv),
  )
const req = { member: { id: ada, handle: 'ada' } } as never

test('with giphyGifs off (production default) a post with a GIF is refused, not stripped', async () => {
  await assert.rejects(controller('production').create(req, { giphy: { id: ID, description: '' } }), (err: unknown) => {
    assert.ok(err instanceof BadRequestException)
    assert.deepEqual(err.getResponse(), { code: 'feature_unavailable', message: 'GIFs are not available yet' })
    return true
  })
  assert.equal((await db.select().from(posts)).length, 0)
})

test('with giphyGifs on a post with a GIF is created', async () => {
  const { id } = await controller('staging').create(req, { giphy: { id: ID, description: '' } })
  assert.equal((await service().post(null, id))!.giphy?.id, ID)
})
