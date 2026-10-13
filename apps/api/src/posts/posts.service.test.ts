import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { InvalidCursorError, PostsService, postText } from './posts.service.js'

const service = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
  ])
})
after(() => pool.end())

const texts = async () => (await service.feed(100)).posts.map((p) => p.text)

test('a post appears in the feed with its author handle', async () => {
  const { id } = await service.create(ada, 'hello')
  const { posts: feed } = await service.feed(10)
  assert.equal(feed.length, 1)
  assert.deepEqual(
    { id: feed[0]!.id, authorId: feed[0]!.authorId, authorHandle: feed[0]!.authorHandle, text: feed[0]!.text },
    { id, authorId: ada, authorHandle: 'ada', text: 'hello' },
  )
})

test('the feed is newest first', async () => {
  for (const text of ['one', 'two', 'three']) await service.create(ada, text)
  assert.deepEqual(await texts(), ['three', 'two', 'one'])
})

test('a member can delete their own post', async () => {
  const { id } = await service.create(ada, 'mine')
  assert.equal(await service.remove(ada, id), true)
  assert.deepEqual(await texts(), [])
  // Soft delete: the row is kept.
  assert.notEqual((await db.select().from(posts).where(eq(posts.id, id)))[0]!.deletedAt, null)
})

test("a member cannot delete someone else's post", async () => {
  const { id } = await service.create(ada, 'mine')
  assert.equal(await service.remove(bayo, id), false)
  assert.deepEqual(await texts(), ['mine'])
})

test('deleting twice, or deleting nothing, reports false', async () => {
  const { id } = await service.create(ada, 'mine')
  await service.remove(ada, id)
  assert.equal(await service.remove(ada, id), false)
  assert.equal(await service.remove(ada, randomUUID()), false)
})

test('posts by an inactive member are hidden and return on reactivation', async () => {
  await service.create(ada, 'from ada')
  await service.create(bayo, 'from bayo')
  await db.update(members).set({ active: false, status: 'suspended' }).where(eq(members.id, bayo))
  assert.deepEqual(await texts(), ['from ada'])
  await db.update(members).set({ active: true, status: null }).where(eq(members.id, bayo))
  assert.deepEqual(await texts(), ['from bayo', 'from ada'])
})

test('pagination walks every post exactly once, including identical timestamps', async () => {
  const at = new Date('2026-01-01T00:00:00.000Z')
  await db.insert(posts).values(Array.from({ length: 7 }, (_, i) => ({ authorId: ada, text: `p${i}`, createdAt: at })))
  await service.create(bayo, 'newest')

  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await service.feed(3, cursor)
    seen.push(...page.posts.map((p) => p.text))
    cursor = page.cursor ?? undefined
    pages++
  } while (cursor)

  assert.equal(pages, 3)
  assert.equal(seen[0], 'newest')
  assert.equal(seen.length, 8)
  assert.equal(new Set(seen).size, 8)
})

test('a tampered cursor is rejected, not executed', async () => {
  await assert.rejects(service.feed(10, 'garbage'), InvalidCursorError)
  const forged = Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000Z', "x' or 1=1 --"])).toString('base64url')
  await assert.rejects(service.feed(10, forged), InvalidCursorError)
})

test('post text: trimmed, non-empty, at most 300 characters as a person counts them', () => {
  assert.equal(postText.parse('  hi  '), 'hi')
  assert.equal(postText.safeParse('   ').success, false)
  assert.equal(postText.safeParse('a'.repeat(300)).success, true)
  assert.equal(postText.safeParse('a'.repeat(301)).success, false)
  // 300 flag emoji are 300 characters to a person but 1,200 UTF-16 code units.
  assert.equal(postText.safeParse('🇳🇬'.repeat(300)).success, true)
  assert.equal(postText.safeParse('🇳🇬'.repeat(301)).success, false)
})
