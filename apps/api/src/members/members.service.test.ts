import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { follows, members, releasedHandles } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { InvalidCursorError } from '../cursor.js'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { CannotFollowSelfError, MENTION_CURSOR_MAX, MembersService, NoSuchMemberError, profileInput } from './members.service.js'

const service = new MembersService(db)
const postsService = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
})
after(() => pool.end())

test('a profile carries counts and how the viewer relates to it', async () => {
  await postsService.create(ada, 'one')
  const deleted = await postsService.create(ada, 'two')
  await postsService.remove(ada, deleted.id)
  await service.follow(bayo, 'ada')
  await service.follow(chi, 'ada')
  await service.follow(ada, 'bayo')

  const asBayo = (await service.profile(bayo, 'ada'))!
  assert.equal(asBayo.handle, 'ada')
  assert.equal(asBayo.postCount, 1)
  assert.equal(asBayo.followerCount, 2)
  assert.equal(asBayo.followingCount, 1)
  assert.equal(asBayo.viewerFollows, true)
  assert.equal(asBayo.isSelf, false)

  assert.equal((await service.profile(ada, 'ada'))!.isSelf, true)
  const anonymous = (await service.profile(null, 'ada'))!
  assert.equal(anonymous.viewerFollows, false)
  assert.equal(anonymous.isSelf, false)
})

test('unknown and suspended members have no profile', async () => {
  assert.equal(await service.profile(null, 'nobody'), null)
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.equal(await service.profile(null, 'chi'), null)
  assert.equal(await service.follow(ada, 'chi'), false)
  assert.equal(await service.follow(ada, 'nobody'), false)
})

test('follow and unfollow are idempotent', async () => {
  assert.equal(await service.follow(ada, 'bayo'), true)
  assert.equal(await service.follow(ada, 'bayo'), true)
  assert.equal((await service.profile(ada, 'bayo'))!.followerCount, 1)

  assert.equal(await service.unfollow(ada, 'bayo'), true)
  assert.equal(await service.unfollow(ada, 'bayo'), true)
  const after = (await service.profile(ada, 'bayo'))!
  assert.equal(after.followerCount, 0)
  assert.equal(after.viewerFollows, false)
})

test('you cannot follow yourself', async () => {
  await assert.rejects(service.follow(ada, 'ada'), CannotFollowSelfError)
})

test('a suspended follower stops counting', async () => {
  await service.follow(chi, 'ada')
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.equal((await service.profile(null, 'ada'))!.followerCount, 0)
})

test('after a rename, a handle resolves to whoever was seen with it most recently', async () => {
  const renamed = randomUUID()
  await db.insert(members).values({ id: renamed, handle: 'ada', lastSeenAt: new Date() })
  assert.equal((await service.profile(null, 'ada'))!.id, renamed)
})

test('a handle given up by renaming is its owner’s for 30 days, and leads to them', async () => {
  // What the settings webhook and Kratos do when ada renames to ada2.
  await service.holdHandle(ada, 'ada')
  await db.update(members).set({ handle: 'ada2' }).where(eq(members.id, ada))

  assert.equal(await service.handleHeld('ada', bayo), true)
  assert.equal(await service.handleHeld('ada', null), true)
  assert.equal(await service.handleHeld('ada', ada), false)
  assert.equal(await service.handleHeld('free', null), false)
  assert.equal(await service.movedTo(null, 'ada'), 'ada2')
  assert.equal(await service.movedTo(null, 'free'), null)

  // Someone ada has blocked is not told where ada went.
  await service.block(ada, 'bayo')
  assert.equal(await service.movedTo(bayo, 'ada'), null)
  assert.equal(await service.movedTo(chi, 'ada'), 'ada2')

  await db.update(releasedHandles).set({ releasedAt: new Date(Date.now() - 31 * 86_400_000) })
  assert.equal(await service.handleHeld('ada', bayo), false)
  assert.equal(await service.movedTo(null, 'ada'), null)
})

test('a held handle belongs to whoever gave it up last; suspended owners are not followed', async () => {
  await service.holdHandle(ada, 'spare')
  await service.holdHandle(bayo, 'spare')
  assert.equal(await service.handleHeld('spare', bayo), false)
  assert.equal(await service.handleHeld('spare', ada), true)

  await db.update(members).set({ active: false }).where(eq(members.id, bayo))
  assert.equal(await service.movedTo(null, 'spare'), null)

  // An identity the API has never seen has nothing to hold.
  await service.holdHandle(randomUUID(), 'ghost')
  assert.equal(await service.handleHeld('ghost', null), false)
})

test('member search matches handle prefixes literally', async () => {
  await db.insert(members).values([
    { id: randomUUID(), handle: 'ada_obi' },
    { id: randomUUID(), handle: 'adaxobi' },
    { id: randomUUID(), handle: 'adaeze', active: false },
  ])
  const found = async (q: string) => (await service.search(q, 10)).map((m) => m.handle)
  assert.deepEqual(await found('ada'), ['ada', 'ada_obi', 'adaxobi'])
  assert.deepEqual(await found('@ADA'), ['ada', 'ada_obi', 'adaxobi'])
  // "_" is a real character in handles, not a single-character wildcard.
  assert.deepEqual(await found('ada_'), ['ada_obi'])
  assert.deepEqual(await found('%'), [])
  assert.deepEqual(await found('zzz'), [])
})

test('blocking is mutual invisibility and ends follows both ways', async () => {
  await service.follow(ada, 'bayo')
  await service.follow(bayo, 'ada')
  const bayoPost = await postsService.create(bayo, 'from bayo')
  await postsService.create(ada, 'from ada')
  await postsService.create(chi, 'from chi')

  assert.equal(await service.block(ada, 'bayo'), true)
  assert.equal(await service.block(ada, 'bayo'), true)
  assert.equal((await db.select().from(follows)).length, 0)

  const seenBy = async (viewer: string) => (await postsService.feed(viewer, 10)).posts.map((p) => p.text)
  assert.deepEqual(await seenBy(ada), ['from chi', 'from ada'])
  assert.deepEqual(await seenBy(bayo), ['from chi', 'from bayo'])
  assert.deepEqual(await seenBy(chi), ['from chi', 'from ada', 'from bayo'])

  // The blocker still sees the profile (to unblock); to the blocked, they are gone.
  assert.equal((await service.profile(ada, 'bayo'))!.viewerBlocks, true)
  assert.equal(await service.profile(bayo, 'ada'), null)
  assert.equal((await service.profile(chi, 'ada'))!.viewerBlocks, false)

  // No following, liking or replying across a block, in either direction.
  assert.equal(await service.follow(bayo, 'ada'), false)
  assert.equal(await service.follow(ada, 'bayo'), false)
  assert.equal(await postsService.like(ada, bayoPost.id), false)
  await assert.rejects(postsService.create(ada, 'reply', { replyTo: bayoPost.id }))
  assert.equal(await postsService.thread(ada, bayoPost.id), null)

  await service.unblock(ada, 'bayo')
  assert.deepEqual(await seenBy(ada), ['from chi', 'from ada', 'from bayo'])
  assert.equal(await service.follow(ada, 'bayo'), true)
})

test('muting is one-sided: only the muter stops seeing posts, except on the profile itself', async () => {
  await postsService.create(bayo, 'from bayo')
  await postsService.create(ada, 'from ada')
  assert.equal(await service.mute(ada, 'bayo'), true)

  const seenBy = async (viewer: string) => (await postsService.feed(viewer, 10)).posts.map((p) => p.text)
  assert.deepEqual(await seenBy(ada), ['from ada'])
  assert.deepEqual(await seenBy(bayo), ['from ada', 'from bayo'])
  assert.equal((await postsService.search(ada, 'bayo', 10)).length, 0)

  const profile = (await service.profile(ada, 'bayo'))!
  assert.equal(profile.viewerMutes, true)
  assert.deepEqual((await postsService.byAuthor(ada, bayo, 10)).posts.map((p) => p.text), ['from bayo'])
  // The muted member can tell nothing: they can still see and follow the muter.
  assert.equal((await service.profile(bayo, 'ada'))!.viewerMutes, false)
  assert.equal(await service.follow(bayo, 'ada'), true)

  await service.unmute(ada, 'bayo')
  assert.deepEqual(await seenBy(ada), ['from ada', 'from bayo'])
})

test('you cannot block or mute yourself or someone who does not exist', async () => {
  assert.equal(await service.block(ada, 'ada'), false)
  assert.equal(await service.mute(ada, 'ada'), false)
  assert.equal(await service.block(ada, 'nobody'), false)
  assert.equal(await service.mute(ada, 'nobody'), false)
})

test('a member can set a name and bio, shown on their profile and their posts', async () => {
  await service.updateProfile(ada, profileInput.parse({ displayName: '  Adaeze   Okafor ', bio: 'Lagos.\n\n\n\nBuilds things.  ' }))
  await postsService.create(ada, 'hello')

  const profile = (await service.profile(null, 'ada'))!
  assert.equal(profile.displayName, 'Adaeze Okafor')
  assert.equal(profile.bio, 'Lagos.\n\nBuilds things.')
  assert.equal((await postsService.feed(null, 10)).posts[0]!.authorName, 'Adaeze Okafor')

  // An empty name goes back to just the handle.
  await service.updateProfile(ada, profileInput.parse({ displayName: '   ', bio: '' }))
  assert.equal((await service.profile(null, 'ada'))!.displayName, null)
  assert.equal((await service.profile(null, 'bayo'))!.bio, '')
})

test('names and bios lose hidden characters and are limited in length', () => {
  // A right-to-left override would make "Ada" + override + "nimda" display as "Adaadmin".
  assert.equal(profileInput.parse({ displayName: 'Ada\u202Enimda', bio: '' }).displayName, 'Adanimda')
  assert.equal(profileInput.parse({ displayName: 'Ch\u200Bidi', bio: 'a\u2066b' }).displayName, 'Chidi')
  assert.equal(profileInput.parse({ displayName: 'x', bio: 'a\u2066b' }).bio, 'ab')
  // Emoji sequences survive: the joiner inside them is kept.
  assert.equal(profileInput.parse({ displayName: 'Family 👨‍👩‍👧', bio: '' }).displayName, 'Family 👨‍👩‍👧')
  assert.equal(profileInput.safeParse({ displayName: '🇳🇬'.repeat(50), bio: '' }).success, true)
  assert.equal(profileInput.safeParse({ displayName: 'a'.repeat(51), bio: '' }).success, false)
  assert.equal(profileInput.safeParse({ displayName: '', bio: 'a'.repeat(161) }).success, false)
  assert.equal(profileInput.safeParse({ displayName: '', bio: 'a'.repeat(160) }).success, true)
})

test('search finds members by name as well as handle, handles first', async () => {
  await service.updateProfile(bayo, profileInput.parse({ displayName: 'Adebayo Ade', bio: '' }))
  await service.updateProfile(chi, profileInput.parse({ displayName: '100% Chi', bio: '' }))
  const found = async (q: string) => (await service.search(q, 10)).map((m) => m.handle)

  assert.deepEqual(await found('ad'), ['ada', 'bayo'])
  assert.deepEqual(await found('Adebayo'), ['bayo'])
  assert.deepEqual(await found('bayo ade'), ['bayo'])
  // "%" and "_" are matched literally, not as wildcards.
  assert.deepEqual(await found('100%'), ['chi'])
  assert.deepEqual(await found('%'), ['chi'])
  assert.deepEqual((await service.search('adebayo', 1))[0], { handle: 'bayo', displayName: 'Adebayo Ade', avatar: null, founder: false })
})

test('the Founder badge is given and taken away by handle, and shows on the profile, posts and search', async () => {
  const post = await postsService.create(ada, 'from a founder')
  await postsService.create(bayo, 'quoting', { quote: post.id })
  const question = await postsService.create(chi, 'a question')
  const answer = await postsService.create(ada, 'an answer', { replyTo: question.id })

  assert.equal((await service.profile(null, 'ada'))!.founderBadge, false)
  assert.equal(await service.setFounder('ada', true), true)
  assert.equal(await service.setFounder('ada', true), false, 'granting twice changes nothing')

  assert.equal((await service.profile(null, 'ada'))!.founderBadge, true)
  assert.equal((await service.profile(null, 'bayo'))!.founderBadge, false)
  assert.deepEqual(
    (await service.search('ada', 10)).map((m) => [m.handle, m.founder]),
    [['ada', true]],
  )
  const feed = (await postsService.feed(null, 10)).posts
  const byHandle = (handle: string) => feed.find((p) => p.authorHandle === handle && !p.replyParentId)!
  assert.equal(byHandle('ada').authorFounder, true)
  assert.equal(byHandle('bayo').authorFounder, false)
  const quoted = byHandle('bayo').quote
  assert.ok(quoted && !quoted.unavailable)
  assert.equal(quoted.authorFounder, true)
  const replies = (await postsService.replies(null, question.id, 10))!.replies
  assert.deepEqual(
    replies.map((r) => (r.unavailable ? null : [r.id, r.authorFounder])),
    [[answer.id, true]],
  )

  assert.equal(await service.setFounder('ada', false), true)
  assert.equal(await service.setFounder('ada', false), false, 'revoking twice changes nothing')
  assert.equal((await service.profile(null, 'ada'))!.founderBadge, false)
  assert.equal((await postsService.feed(null, 10)).posts.find((p) => p.id === post.id)!.authorFounder, false)

  await assert.rejects(service.setFounder('nobody', true), NoSuchMemberError)
})

test('mention suggestions put followed people first and match handle or name starts', async () => {
  const [ade, adaeze, tunde, kola] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  await db.insert(members).values([
    { id: ade, handle: 'ade_x' },
    { id: adaeze, handle: 'zee', displayName: 'Adaeze Okafor' },
    { id: tunde, handle: 'tunde', displayName: 'Tunde Adewale' },
    { id: kola, handle: 'adekola', active: false },
  ])
  const handles = async (viewer: string, q: string) => (await service.suggestMentions(viewer, q)).members.map((m) => m.handle)

  // Handle starts, then name starts; never the viewer or an inactive member.
  assert.deepEqual(await handles(bayo, 'ad'), ['ada', 'ade_x', 'zee'])
  assert.deepEqual(await handles(ada, 'ad'), ['ade_x', 'zee'])

  // A followed member comes first, and any word of their name counts.
  await service.follow(bayo, 'tunde')
  const asBayo = (await service.suggestMentions(bayo, 'ad')).members
  assert.deepEqual(asBayo.map((m) => [m.handle, m.following]), [['tunde', true], ['ada', false], ['ade_x', false], ['zee', false]])

  // "_" is matched as written, not as a wildcard.
  assert.deepEqual(await handles(bayo, 'ade_'), ['ade_x'])
  assert.deepEqual(await handles(bayo, 'ada_'), [])

  // Blocks either way hide the member.
  await service.block(ada, 'bayo')
  assert.deepEqual(await handles(bayo, 'ad'), ['tunde', 'ade_x', 'zee'])
  assert.deepEqual(await handles(chi, 'AD'), ['ada', 'ade_x', 'zee'])
  assert.deepEqual(await handles(bayo, 'a d'), [])
})

test('mention suggestions page through followed members, then others by handle, then by name', async () => {
  const add = async (rows: { handle: string; displayName?: string }[]) =>
    db.insert(members).values(rows.map((r) => ({ id: randomUUID(), ...r })))
  await add(Array.from({ length: 12 }, (_, i) => ({ handle: `kaf${String(i).padStart(2, '0')}` })))
  for (let i = 0; i < 12; i++) await service.follow(ada, `kaf${String(i).padStart(2, '0')}`)
  await add([{ handle: 'kao' }, { handle: 'kap' }, { handle: 'kaq' }, { handle: 'kar' }, { handle: 'kas' }])
  await add([{ handle: 'zz1', displayName: 'Kayode B' }, { handle: 'zz0', displayName: 'Kayode B' }])

  const pages: { handle: string; following: boolean }[][] = []
  let cursor: string | undefined
  do {
    const page = await service.suggestMentions(ada, 'ka', cursor, 5)
    pages.push(page.members.map(({ handle, following }) => ({ handle, following })))
    cursor = page.cursor ?? undefined
  } while (cursor)

  // Pages end inside each part: followed, others by handle (kaq), others by name.
  const all = pages.flat()
  assert.deepEqual(pages.map((p) => p.length), [5, 5, 5, 4])
  assert.deepEqual(all.filter((m) => m.following).map((m) => m.handle), Array.from({ length: 12 }, (_, i) => `kaf${String(i).padStart(2, '0')}`))
  assert.deepEqual(all.filter((m) => !m.following).map((m) => m.handle), ['kao', 'kap', 'kaq', 'kar', 'kas', 'zz0', 'zz1'])
  assert.equal(all.findIndex((m) => !m.following), 12, 'everyone followed comes before anyone else')

  await assert.rejects(service.suggestMentions(ada, 'ka', 'not-a-cursor'), InvalidCursorError)
})

test('the member whose handle is exactly what was typed comes first, followed or not', async () => {
  await db.insert(members).values([
    { id: randomUUID(), handle: 'adaeze' },
    { id: randomUUID(), handle: 'adam' },
    { id: randomUUID(), handle: 'tolu', displayName: 'Tolu Ada' },
  ])
  await service.follow(bayo, 'adaeze')
  await service.follow(bayo, 'tolu')
  const rows = async (cursor?: string, limit?: number) => service.suggestMentions(bayo, 'ada', cursor, limit)
  const pairs = (page: { members: { handle: string; following: boolean }[] }) => page.members.map((m) => [m.handle, m.following])

  assert.deepEqual(pairs(await rows()), [['ada', false], ['adaeze', true], ['tolu', true], ['adam', false]])

  // Followed, they are still listed once, first.
  await service.follow(bayo, 'ada')
  assert.deepEqual(pairs(await rows()), [['ada', true], ['adaeze', true], ['tolu', true], ['adam', false]])

  // One at a time, the pages give the same list.
  const handles: string[] = []
  let cursor: string | undefined
  do {
    const page = await rows(cursor, 1)
    handles.push(...page.members.map((m) => m.handle))
    cursor = page.cursor ?? undefined
  } while (cursor)
  assert.deepEqual(handles, ['ada', 'adaeze', 'tolu', 'adam'])
})

test('a cursor carries even the longest name a member can have to the next page', async () => {
  // 50 characters of 16 UTF-16 units each (a Thai letter and its marks), 3 bytes apiece in UTF-8.
  const { displayName } = profileInput.parse({ displayName: `Ka${'ก'.padEnd(16, 'ั').repeat(48)}`, bio: '' })
  await db.insert(members).values([
    { id: randomUUID(), handle: 'zz_a', displayName },
    { id: randomUUID(), handle: 'zz_b', displayName },
  ])

  const first = await service.suggestMentions(ada, 'ka', undefined, 1)
  assert.deepEqual(first.members.map((m) => m.handle), ['zz_a'])
  assert.ok(first.cursor && first.cursor.length > 2000 && first.cursor.length <= MENTION_CURSOR_MAX, `cursor of ${first.cursor?.length}`)
  const second = await service.suggestMentions(ada, 'ka', first.cursor, 1)
  assert.deepEqual(second.members.map((m) => m.handle), ['zz_b'])
  assert.equal(second.cursor, null)
})
