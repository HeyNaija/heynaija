import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { communities, communityMemberships, follows, members, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { CommunityNotFoundError, NotACommunityMemberError, PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { CommunitiesService } from './communities.service.js'

const service = new CommunitiesService(db)
const postsService = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
let lagos: string

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
  const rows = await db
    .insert(communities)
    .values([
      { slug: 'lagos', name: 'Lagos', description: 'Lagos things', rules: 'Be kind' },
      { slug: 'abuja', name: 'Abuja', description: 'Abuja things' },
    ])
    .returning({ id: communities.id, slug: communities.slug })
  lagos = rows.find((r) => r.slug === 'lagos')!.id
})
after(() => pool.end())

test('the list is alphabetical, with member counts and the viewer\'s own membership', async () => {
  await service.join(ada, 'lagos')
  await service.join(bayo, 'lagos')

  const asAda = await service.list(ada)
  assert.deepEqual(asAda.map((c) => [c.slug, c.memberCount, c.viewerIsMember]), [
    ['abuja', 0, false],
    ['lagos', 2, true],
  ])
  assert.deepEqual((await service.list(null)).map((c) => c.viewerIsMember), [false, false])
  assert.equal((await service.list(chi)).find((c) => c.slug === 'lagos')!.viewerIsMember, false)
})

test('join and leave are idempotent', async () => {
  assert.equal(await service.join(ada, 'lagos'), true)
  assert.equal(await service.join(ada, 'lagos'), true)
  assert.equal((await service.detail(ada, 'lagos'))!.memberCount, 1)

  assert.equal(await service.leave(ada, 'lagos'), true)
  assert.equal(await service.leave(ada, 'lagos'), true)
  const after = (await service.detail(ada, 'lagos'))!
  assert.equal(after.memberCount, 0)
  assert.equal(after.viewerIsMember, false)
})

test('detail carries the rules and the moderators\' handles', async () => {
  await service.join(ada, 'lagos')
  await service.join(bayo, 'lagos')
  await db.update(communityMemberships).set({ role: 'moderator' }).where(eq(communityMemberships.memberId, bayo))
  const detail = (await service.detail(null, 'lagos'))!
  assert.equal(detail.rules, 'Be kind')
  assert.deepEqual(detail.moderators, ['bayo'])
})

test('unknown and inactive communities are not found and cannot be joined', async () => {
  assert.equal(await service.detail(null, 'nowhere'), null)
  assert.equal(await service.join(ada, 'nowhere'), false)

  await db.update(communities).set({ active: false }).where(eq(communities.id, lagos))
  assert.equal(await service.detail(null, 'lagos'), null)
  assert.equal(await service.join(ada, 'lagos'), false)
  assert.deepEqual((await service.list(null)).map((c) => c.slug), ['abuja'])
})

test('a suspended member stops counting', async () => {
  await service.join(chi, 'lagos')
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.equal((await service.detail(null, 'lagos'))!.memberCount, 0)
})

test('only members can post into a community', async () => {
  await assert.rejects(postsService.create(ada, 'hi', { communitySlug: 'lagos' }), NotACommunityMemberError)
  await assert.rejects(postsService.create(ada, 'hi', { communitySlug: 'nowhere' }), CommunityNotFoundError)

  await service.join(ada, 'lagos')
  await postsService.create(ada, 'hello lagos', { communitySlug: 'lagos' })
  await postsService.create(ada, 'hello everyone')

  const inLagos = (await postsService.inCommunity(null, lagos, 10)).posts
  assert.deepEqual(inLagos.map((p) => p.text), ['hello lagos'])
  assert.deepEqual(inLagos[0]!.community, { slug: 'lagos', name: 'Lagos' })

  // Community posts are public: they also appear in the Latest feed, labelled.
  const latest = (await postsService.feed(null, 10)).posts
  assert.deepEqual(latest.map((p) => [p.text, p.community?.slug ?? null]), [
    ['hello everyone', null],
    ['hello lagos', 'lagos'],
  ])
})

test('a reply inherits its parent\'s community, even from a non-member', async () => {
  await service.join(ada, 'lagos')
  const root = await postsService.create(ada, 'root', { communitySlug: 'lagos' })
  const reply = await postsService.create(bayo, 'reply', { replyTo: root.id, communitySlug: 'abuja' })
  const [row] = await db.select().from(posts).where(eq(posts.id, reply.id))
  assert.equal(row!.communityId, lagos)
})

test('leaving a community keeps your posts there', async () => {
  await service.join(ada, 'lagos')
  await postsService.create(ada, 'still here', { communitySlug: 'lagos' })
  await service.leave(ada, 'lagos')
  assert.deepEqual((await postsService.inCommunity(null, lagos, 10)).posts.map((p) => p.text), ['still here'])
})

test('the following feed mixes people and communities, and says why each post is there', async () => {
  await service.join(bayo, 'lagos')
  await service.join(chi, 'lagos')
  await postsService.create(bayo, 'from someone I follow')
  await postsService.create(chi, 'from my community', { communitySlug: 'lagos' })
  await postsService.create(chi, 'from a stranger')
  await postsService.create(bayo, 'followed AND in my community', { communitySlug: 'lagos' })
  await postsService.create(ada, 'mine')

  await db.insert(follows).values({ followerId: ada, followeeId: bayo })
  await service.join(ada, 'lagos')

  const feed = (await postsService.followingFeed(ada, 10)).posts
  assert.deepEqual(feed.map((p) => [p.text, p.reason]), [
    ['mine', 'own'],
    ['followed AND in my community', 'following'],
    ['from my community', 'community'],
    ['from someone I follow', 'following'],
  ])
  // Outside the following feed there is no reason to give.
  assert.equal((await postsService.feed(ada, 10)).posts[0]!.reason, null)
})

test('a post in a deactivated community loses its label but is not lost', async () => {
  await service.join(ada, 'lagos')
  await postsService.create(ada, 'orphaned', { communitySlug: 'lagos' })
  await db.update(communities).set({ active: false }).where(eq(communities.id, lagos))
  const [post] = (await postsService.byAuthor(null, ada, 10)).posts
  assert.equal(post!.text, 'orphaned')
  assert.equal(post!.community, null)
})

test('community search matches name or description, case-insensitively and literally', async () => {
  const found = async (q: string) => (await service.search(null, q, 10)).map((c) => c.slug)
  assert.deepEqual(await found('LAG'), ['lagos'])
  assert.deepEqual(await found('things'), ['abuja', 'lagos'])
  assert.deepEqual(await found('%'), [])
  assert.deepEqual(await found('_'), [])
})
