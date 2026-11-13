import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { communities, communityMemberships, members, notificationOptOuts, notifications, posts } from '@heynaija/db'
import { and, eq, sql } from 'drizzle-orm'
import { linesFor } from '../email/digest.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import {
  AnnouncementTooSoonError,
  ImagesNotReadyError,
  NotACommunityMemberError,
  NotACommunityModeratorError,
  NotAnAnnouncementError,
  PostsService,
} from '../posts/posts.service.js'
import { pushMessages } from '../push/push-message.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { ANNOUNCEMENT_EVERY_H } from './announcements.js'
import { CommunitiesService } from './communities.service.js'

// Community announcements (docs/adr/0029): a moderator notifies every member of
// a community about a new post in it, once a day.
const service = new PostsService(db)
const inbox = new NotificationsService(db)
const places = new CommunitiesService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const outsider = randomUUID()
const mod = randomUUID()
const mod2 = randomUUID()
const siteMod = randomUUID()
const lagos = randomUUID()
const abuja = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: outsider, handle: 'outsider' },
    { id: mod, handle: 'lagos_mod' },
    { id: mod2, handle: 'lagos_mod2' },
    { id: siteMod, handle: 'site_mod', role: 'moderator' },
  ])
  await db.insert(communities).values([
    { id: lagos, slug: 'lagos', name: 'Lagos', description: 'Eko' },
    { id: abuja, slug: 'abuja', name: 'Abuja', description: 'FCT' },
  ])
  await db.insert(communityMemberships).values([
    { communityId: lagos, memberId: ada },
    { communityId: lagos, memberId: bayo },
    { communityId: lagos, memberId: chi },
    { communityId: lagos, memberId: mod, role: 'moderator' },
    { communityId: lagos, memberId: mod2, role: 'moderator' },
    { communityId: abuja, memberId: ada },
    { communityId: abuja, memberId: mod, role: 'moderator' },
  ])
})
after(() => pool.end())

const announce = (authorId: string, text: string, slug = 'lagos') => service.create(authorId, text, { communitySlug: slug, announce: true })
/** Who was told about a post, and how, by handle. */
const toldOf = async (postId: string) => {
  const rows = await db
    .select({ handle: members.handle, kind: notifications.kind })
    .from(notifications)
    .innerJoin(members, eq(members.id, notifications.recipientId))
    .where(eq(notifications.postId, postId))
  return Object.fromEntries(rows.map((r) => [r.handle, r.kind]))
}
const kindsFor = async (memberId: string) => (await inbox.list(memberId, 20)).notifications.map((n) => n.kind)
/** As if the community's last announcement went `hours` ago. */
const lastAnnounced = (communityId: string, hours: number) =>
  db.update(communities).set({ announcedAt: sql`now() - make_interval(hours => ${hours})` }).where(eq(communities.id, communityId))
const postCount = async () => (await db.select({ id: posts.id }).from(posts)).length

test('an announcement tells every member of the community once, and nobody else', async () => {
  // Chi turned this community's announcements off; nobody outside it is told, nor the author.
  assert.equal(await places.setAnnouncements(chi, 'lagos', false), true)
  const post = await announce(mod, 'Meet-up on Saturday at 4pm')
  assert.deepEqual(await toldOf(post.id), { ada: 'community_announcement', bayo: 'community_announcement', lagos_mod2: 'community_announcement' })

  const [seen] = (await inbox.list(ada, 20)).notifications
  assert.equal(seen!.kind, 'community_announcement')
  assert.equal(seen!.actor!.handle, 'lagos_mod')
  assert.deepEqual(seen!.community, { slug: 'lagos', name: 'Lagos' })
  assert.deepEqual(seen!.post, { id: post.id, excerpt: 'Meet-up on Saturday at 4pm', gistId: null })
  assert.equal(await inbox.unreadCount(ada), 1)
  assert.equal(await inbox.unreadCount(outsider), 0)

  // An ordinary post in the community tells no one.
  const plain = await service.create(mod, 'just a post', { communitySlug: 'lagos' })
  assert.deepEqual(await toldOf(plain.id), {})
})

test('a member the announcement names is told that, not both, and one who turned announcements off is told nothing', async () => {
  await db.insert(notificationOptOuts).values({ memberId: bayo, kind: 'community_announcement' })
  const post = await announce(mod, 'Thanks @ada for hosting, and @outsider for the venue')
  assert.deepEqual(await toldOf(post.id), {
    ada: 'mention',
    outsider: 'mention',
    chi: 'community_announcement',
    lagos_mod2: 'community_announcement',
  })
})

test('only the community’s moderators, and site moderators who have joined, can announce', async () => {
  await assert.rejects(announce(ada, 'not a moderator'), NotACommunityModeratorError)
  // A moderator of another community is an ordinary member here.
  await db.insert(communityMemberships).values({ communityId: abuja, memberId: bayo, role: 'moderator' })
  await assert.rejects(announce(bayo, 'moderates Abuja only'), NotACommunityModeratorError)
  await assert.rejects(announce(siteMod, 'has not joined'), NotACommunityMemberError)
  await assert.rejects(announce(outsider, 'has not joined'), NotACommunityMemberError)
  assert.equal(await postCount(), 0, 'a refused announcement posts nothing')

  await db.insert(communityMemberships).values({ communityId: lagos, memberId: siteMod })
  const post = await announce(siteMod, 'from the site moderators')
  assert.equal((await toldOf(post.id)).ada, 'community_announcement')
})

test('only a new top-level post in a community can be an announcement', async () => {
  const first = await service.create(mod, 'a post', { communitySlug: 'lagos' })
  await assert.rejects(service.create(mod, 'everyone', { announce: true }), NotAnAnnouncementError)
  await assert.rejects(service.create(mod, 'a reply', { replyTo: first.id, announce: true }), NotAnAnnouncementError)
  await assert.rejects(service.create(mod, 'an update', { storyOf: first.id, communitySlug: 'lagos', announce: true }), NotAnAnnouncementError)
  assert.equal(await postCount(), 1)
})

test('a community announces once a day, whichever moderator sends it', async () => {
  await announce(mod, 'first')
  const refused = await announce(mod2, 'second, from another moderator').catch((err: unknown) => err)
  assert.ok(refused instanceof AnnouncementTooSoonError)
  const hoursLeft = (refused.nextAt.getTime() - Date.now()) / 3_600_000
  assert.ok(hoursLeft > ANNOUNCEMENT_EVERY_H - 0.1 && hoursLeft <= ANNOUNCEMENT_EVERY_H, `next in ${hoursLeft} hours`)
  assert.equal(await postCount(), 1, 'the refused one is not posted')

  // The limit is the community's: an ordinary post still goes, and so does another community's announcement.
  await service.create(mod2, 'an ordinary post', { communitySlug: 'lagos' })
  const elsewhere = await announce(mod, 'in Abuja', 'abuja')
  assert.deepEqual(await toldOf(elsewhere.id), { ada: 'community_announcement' })

  await lastAnnounced(lagos, ANNOUNCEMENT_EVERY_H - 1)
  await assert.rejects(announce(mod, 'an hour early'), AnnouncementTooSoonError)
  await lastAnnounced(lagos, ANNOUNCEMENT_EVERY_H + 1)
  const next = await announce(mod2, 'the next day')
  assert.equal((await toldOf(next.id)).ada, 'community_announcement')
})

test('two announcements sent at once: one goes', async () => {
  const sent = await Promise.allSettled([announce(mod, 'one'), announce(mod2, 'two')])
  assert.deepEqual(sent.map((s) => s.status).sort(), ['fulfilled', 'rejected'])
  assert.ok((sent.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason instanceof AnnouncementTooSoonError)
  assert.equal(await postCount(), 1)
})

test('an announcement that fails to post does not use up the day’s one', async () => {
  await assert.rejects(
    service.create(mod, 'with a picture that is not there', { communitySlug: 'lagos', announce: true, images: [{ id: randomUUID(), alt: '' }] }),
    ImagesNotReadyError,
  )
  const [community] = await db.select({ announcedAt: communities.announcedAt }).from(communities).where(eq(communities.id, lagos))
  assert.equal(community!.announcedAt, null)
  await announce(mod, 'this one goes')
})

test('an announcement shows only while the member is in the community with its announcements on, and the post is up', async () => {
  const post = await announce(mod, 'hello Lagos')
  assert.deepEqual(await kindsFor(ada), ['community_announcement'])

  // Turning them off for this community hides what was said, so nothing waiting is pushed or emailed.
  assert.equal(await places.setAnnouncements(ada, 'lagos', false), true)
  assert.deepEqual(await kindsFor(ada), [])
  assert.equal(await places.setAnnouncements(ada, 'lagos', true), true)
  assert.deepEqual(await kindsFor(ada), ['community_announcement'])

  await places.leave(bayo, 'lagos')
  assert.deepEqual(await kindsFor(bayo), [])

  await service.remove(mod, post.id)
  assert.deepEqual(await kindsFor(ada), [])
})

test('turning a community’s announcements off is the member’s own, per community', async () => {
  assert.equal(await places.setAnnouncements(ada, 'lagos', false), true)
  assert.equal(await places.setAnnouncements(ada, 'lagos', false), true, 'twice is harmless')
  assert.equal(await places.setAnnouncements(outsider, 'lagos', false), false, 'not a member')
  assert.equal(await places.setAnnouncements(ada, 'nowhere', false), false)
  const mine = await db
    .select({ communityId: communityMemberships.communityId, on: communityMemberships.announcements })
    .from(communityMemberships)
    .where(eq(communityMemberships.memberId, ada))
  assert.deepEqual(Object.fromEntries(mine.map((m) => [m.communityId, m.on])), { [lagos]: false, [abuja]: true })
  // Bayo's is untouched.
  const [bayos] = await db
    .select({ on: communityMemberships.announcements })
    .from(communityMemberships)
    .where(and(eq(communityMemberships.memberId, bayo), eq(communityMemberships.communityId, lagos)))
  assert.equal(bayos!.on, true)
})

test('a community says who may announce, when the next can go, and whether the viewer is told', async () => {
  const view = async (viewerId: string | null, on = true) => {
    const c = (await places.detail(viewerId, 'lagos', on))!
    return { can: c.viewerCanAnnounce, next: c.nextAnnouncementAt, told: c.viewerGetsAnnouncements }
  }
  assert.deepEqual(await view(mod), { can: true, next: null, told: true })
  assert.deepEqual(await view(ada), { can: false, next: null, told: true })
  assert.deepEqual(await view(outsider), { can: false, next: null, told: null })
  assert.deepEqual(await view(siteMod), { can: false, next: null, told: null }, 'a site moderator who has not joined')
  assert.deepEqual(await view(null), { can: false, next: null, told: null })

  await announce(mod, 'today’s')
  await places.setAnnouncements(ada, 'lagos', false)
  const after = await view(mod2)
  assert.equal(after.can, true)
  assert.ok(after.next instanceof Date)
  const hoursLeft = (after.next.getTime() - Date.now()) / 3_600_000
  assert.ok(hoursLeft > ANNOUNCEMENT_EVERY_H - 0.1 && hoursLeft <= ANNOUNCEMENT_EVERY_H, `next in ${hoursLeft} hours`)
  // Only someone who may announce is told when the next can go.
  assert.deepEqual(await view(ada), { can: false, next: null, told: false })

  // While announcements are not offered (the flag), nothing about them is said.
  assert.deepEqual(await view(mod, false), { can: false, next: null, told: null })
  assert.deepEqual(await view(mod), { can: true, next: after.next, told: true })

  // The list says the same, for the composer's choice of community.
  const listed = (await places.list(mod, true)).find((c) => c.slug === 'abuja')!
  assert.deepEqual([listed.viewerCanAnnounce, listed.nextAnnouncementAt, listed.viewerGetsAnnouncements], [true, null, true])
})

test('push and email name the moderator and the community, and quote the post', () => {
  const item = { kind: 'community_announcement' as const, actor: 'lagos_mod', postId: 'p1', excerpt: 'Meet-up on Saturday', community: 'Lagos' }
  assert.deepEqual(linesFor([item], 'https://heynaija.ng').map(({ headline, quote, href }) => ({ headline, quote, href })), [
    { headline: '@lagos_mod posted an announcement in Lagos', quote: 'Meet-up on Saturday', href: 'https://heynaija.ng/p/p1' },
  ])
  assert.deepEqual(pushMessages([{ ...item, id: 'n1', pending: true }]).messages, [
    { title: '@lagos_mod posted an announcement in Lagos', body: '“Meet-up on Saturday”', url: '/p/p1', tag: 'community_announcement:p1' },
  ])
})
