import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, members, mutes, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { PostsService } from './posts.service.js'

// The parent a reply in a list (profile, search, feeds) answers: who wrote it and
// the start of its text, only when the viewer could read that post themselves.
const service = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const viewer = randomUUID()
const SECRET = 'secret-words-xyz'

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo B' },
    { id: chi, handle: 'chi' },
    { id: viewer, handle: 'viewer' },
  ])
})
after(() => pool.end())

const repliesBy = async (viewerId: string | null) => (await service.byAuthor(viewerId, ada, 20, undefined, 'replies')).posts
const contextOf = async (viewerId: string | null, replyId: string) => (await repliesBy(viewerId)).find((p) => p.id === replyId)?.replyTo

test('a reply in a list carries its parent: handle, name, picture and a short excerpt', async () => {
  const text = `${'word '.repeat(40)}end`
  const parent = await service.create(bayo, text)
  const reply = await service.create(ada, 'answers needle', { replyTo: parent.id })
  const context = await contextOf(null, reply.id)
  assert.ok(context && !context.unavailable)
  assert.equal(context.id, parent.id)
  assert.equal(context.authorHandle, 'bayo')
  assert.equal(context.authorName, 'Bayo B')
  assert.equal(context.authorAvatar, null)
  assert.ok([...context.excerpt].length <= 80)
  assert.ok(context.excerpt.endsWith('…'))
  assert.ok(text.startsWith(context.excerpt.slice(0, -1)))
})

test('search carries it too, and a short parent is quoted whole on one line', async () => {
  const parent = await service.create(chi, 'two\n\nlines')
  const reply = await service.create(ada, 'answers needle', { replyTo: parent.id })
  const [found] = await service.search(null, 'needle', 10)
  assert.equal(found!.id, reply.id)
  assert.ok(found!.replyTo && !found!.replyTo.unavailable)
  assert.equal(found!.replyTo.excerpt, 'two lines')
})

test('a post that answers nothing has no context, and thread reads leave it off', async () => {
  const root = await service.create(ada, 'root')
  const reply = await service.create(bayo, 'reply', { replyTo: root.id })
  assert.equal((await service.feed(null, 10)).posts[0]!.replyTo, null)
  const thread = (await service.thread(null, reply.id))!
  assert.equal(thread.post.replyTo, null)
  assert.equal(thread.ancestors[0]!.replyTo, null)
})

test('a deleted or taken-down parent is only a placeholder, without its text or author', async () => {
  const gone = await service.create(bayo, `${SECRET} deleted`)
  const taken = await service.create(bayo, `${SECRET} removed`)
  const one = await service.create(ada, 'answers deleted', { replyTo: gone.id })
  const two = await service.create(ada, 'answers removed', { replyTo: taken.id })
  await service.remove(bayo, gone.id)
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, taken.id))
  assert.deepEqual(await contextOf(null, one.id), { unavailable: true })
  assert.deepEqual(await contextOf(null, two.id), { unavailable: true })
  const sent = JSON.stringify(await repliesBy(null))
  assert.ok(!sent.includes(SECRET) && !sent.includes('Bayo B'))
})

test('a parent by someone the viewer blocked, was blocked by or muted, or who left, is a placeholder', async () => {
  const parent = await service.create(chi, `${SECRET} chi`)
  const reply = await service.create(ada, 'answers chi', { replyTo: parent.id })
  assert.ok(!(await contextOf(viewer, reply.id))!.unavailable)

  await db.insert(blocks).values({ blockerId: viewer, blockedId: chi })
  assert.deepEqual(await contextOf(viewer, reply.id), { unavailable: true })
  await db.delete(blocks)

  await db.insert(blocks).values({ blockerId: chi, blockedId: viewer })
  assert.deepEqual(await contextOf(viewer, reply.id), { unavailable: true })
  await db.delete(blocks)

  await db.insert(mutes).values({ muterId: viewer, mutedId: chi })
  assert.deepEqual(await contextOf(viewer, reply.id), { unavailable: true })
  await db.delete(mutes)
  // Others still see it.
  assert.ok(!(await contextOf(null, reply.id))!.unavailable)

  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.deepEqual(await contextOf(null, reply.id), { unavailable: true })
  assert.ok(!JSON.stringify(await repliesBy(viewer)).includes(SECRET))
})
