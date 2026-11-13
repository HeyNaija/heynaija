import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, gistMembers, gists, members, notifications, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { ModerationService } from '../moderation/moderation.service.js'
import { PostsService } from '../posts/posts.service.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { db, giveBirthDates, migrate, pool, reset } from '../test-db.js'
import { FakeRoomService } from './fake-room-service.js'
import type { GistsGate } from './gists-enabled.guard.js'
import { GistRepliesService } from './gist-replies.service.js'
import { GistError, GistsService, type GistsConfig } from './gists.service.js'

const people = ['ada', 'bayo', 'chi', 'dayo', 'outsider', 'sam'] as const
type Person = (typeof people)[number]
const id = Object.fromEntries(people.map((p) => [p, randomUUID()])) as Record<Person, string>
const as = (p: Person) => ({ id: id[p], handle: p })
const config: GistsConfig = { maxCohosts: 2, maxSpeakers: 2, listenerCap: 3, livekitUrl: 'wss://livekit.test' }
const gate: Pick<GistsGate, 'access'> = { access: async () => ({ member: (memberId) => memberId !== id.outsider, anyone: true }) }
const told = async (recipient: Person) =>
  (await db.select({ kind: notifications.kind }).from(notifications).where(eq(notifications.recipientId, id[recipient]))).map((n) => n.kind)

let repliesOn = true
let previewsOn = true
const flags = { isEnabled: async (key: string) => (key === 'linkPreviews' ? previewsOn : repliesOn) }
let rooms: FakeRoomService
let gistsService: GistsService
let service: GistRepliesService
let requested: string[]
let gist: string
const moderation = new ModerationService(db)

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
  } catch (err: unknown) {
    assert.ok(err instanceof GistError, String(err))
    return err.code
  }
  return 'ok'
}

before(migrate)
beforeEach(async () => {
  await reset()
  repliesOn = true
  previewsOn = true
  await db.insert(members).values(people.map((p) => ({ id: id[p], handle: p })))
  await giveBirthDates(people.map((p) => id[p]))
  rooms = new FakeRoomService()
  gistsService = new GistsService(db, rooms, config, new MemoryRateLimiter(), gate)
  requested = []
  service = new GistRepliesService(gistsService, new PostsService(db), flags, { request: async (url: string) => void requested.push(url) })
  gist = (await gistsService.create(as('ada'), { title: 'Jollof wars' })).id
})
after(() => pool.end())

const say = (p: Person, text: string, replyTo?: string) => service.create(as(p), gist, { text, replyTo })

test('anyone who can see the Gist can reply, read the replies and answer a reply', async () => {
  const first = await say('bayo', 'Team party jollof')
  const nested = await say('chi', 'Never', first.id)
  const page = await service.list(as('dayo'), gist, { order: 'newest' })
  assert.deepEqual(page.replies.map((r) => r.id), [first.id])
  assert.equal(page.count, 2)
  assert.equal(page.viewerCanReply, true)
  assert.equal(page.viewerIsHost, false)
  assert.equal(page.replyAudience, 'everyone')
  const branch = await service.branch(as('dayo'), gist, first.id, { order: 'oldest' })
  assert.deepEqual(branch.replies.map((r) => r.id), [nested.id])
  assert.equal(branch.viewerIsHost, false)
  assert.equal((await service.branch(as('ada'), gist, first.id, { order: 'oldest' })).viewerIsHost, true)
  assert.equal((await service.get(as('dayo'), gist, nested.id)).text, 'Never')
})

test('a member the gists flag is off for, and a signed-out caller, learn nothing: not found', async () => {
  const first = await say('bayo', 'hi')
  assert.equal(await codeOf(service.list(as('outsider'), gist, { order: 'newest' })), 'not_found')
  assert.equal(await codeOf(service.create(as('outsider'), gist, { text: 'let me in' })), 'not_found')
  assert.equal(await codeOf(service.get(as('outsider'), gist, first.id)), 'not_found')
  assert.equal(await codeOf(service.list(as('ada'), randomUUID(), { order: 'newest' })), 'not_found')
  assert.equal(await codeOf(service.list(as('ada'), 'not-a-uuid', { order: 'newest' })), 'not_found')
})

test('a community Gist\'s replies are for the community\'s members', async () => {
  const [community] = await db.insert(communities).values({ slug: 'lagos', name: 'Lagos', description: 'Eko' }).returning({ id: communities.id })
  await db.insert(communityMemberships).values([
    { communityId: community!.id, memberId: id.ada },
    { communityId: community!.id, memberId: id.bayo },
  ])
  const room = (await gistsService.create(as('bayo'), { title: 'Lagos only', communityId: community!.id })).id
  await service.create(as('bayo'), room, { text: 'hello Lagos' })
  assert.equal((await service.list(as('ada'), room, { order: 'newest' })).replies.length, 1)
  assert.equal(await codeOf(service.list(as('chi'), room, { order: 'newest' })), 'not_found')
  assert.equal(await codeOf(service.create(as('chi'), room, { text: 'let me in' })), 'not_found')
})

test('replies are open before the Gist starts, while it is live and after it ends, and stay when it ends', async () => {
  await say('bayo', 'while live')
  await gistsService.end(as('ada'), gist)
  await say('chi', 'after the end')
  const page = await service.list(as('dayo'), gist, { order: 'oldest' })
  assert.deepEqual(page.replies.map((r) => 'text' in r && r.text), ['while live', 'after the end'])
  await db.update(gists).set({ status: 'scheduled' }).where(eq(gists.id, gist))
  await say('dayo', 'before it starts')
  assert.equal((await service.list(as('dayo'), gist, { order: 'newest' })).count, 3)
})

test('a member who is blocked by the host, or blocked someone on the stage, cannot see or write', async () => {
  await db.insert(blocks).values({ blockerId: id.ada, blockedId: id.dayo })
  assert.equal(await codeOf(say('dayo', 'blocked by the host')), 'not_found')
  assert.equal(await codeOf(service.list(as('dayo'), gist, { order: 'newest' })), 'not_found')
  await db.insert(blocks).values({ blockerId: id.chi, blockedId: id.ada })
  assert.equal(await codeOf(say('chi', 'blocked the host')), 'not_found')
})

test('the host\'s reply controls: off refuses everyone but the host, and the host can change them any time', async () => {
  await service.setReplyAudience(as('ada'), gist, 'off')
  assert.equal(await codeOf(say('bayo', 'closed')), 'reply_not_allowed')
  assert.equal(await codeOf(say('ada', 'the host may')), 'ok')
  assert.equal((await service.list(as('bayo'), gist, { order: 'newest' })).replyAudience, 'off')
  assert.equal(await codeOf(service.setReplyAudience(as('bayo'), gist, 'everyone')), 'forbidden')
  await gistsService.end(as('ada'), gist)
  await service.setReplyAudience(as('ada'), gist, 'everyone')
  assert.equal(await codeOf(say('bayo', 'open again')), 'ok')
})

test('with the gistReplies flag off nobody can write, but replies stay readable and a member can delete their own', async () => {
  const first = await say('bayo', 'before the switch')
  repliesOn = false
  assert.equal(await codeOf(say('chi', 'too late')), 'not_found')
  assert.equal((await service.list(as('chi'), gist, { order: 'newest' })).replies.length, 1)
  assert.equal(await new PostsService(db).remove(id.bayo, first.id), true)
})

test('only the host can hide a reply, which shows a placeholder to everyone, and unhide it', async () => {
  const first = await say('bayo', 'rude words')
  assert.equal(await codeOf(service.hide(as('chi'), gist, first.id, true)), 'forbidden')
  assert.equal(await codeOf(service.hide(as('ada'), gist, randomUUID(), true)), 'not_found')
  await service.hide(as('ada'), gist, first.id, true)
  for (const viewer of ['ada', 'bayo', 'chi'] as const) {
    const [placeholder] = (await service.list(as(viewer), gist, { order: 'newest' })).replies
    assert.deepEqual({ unavailable: true, hiddenByHost: true, id: first.id }, { unavailable: 'unavailable' in placeholder! && placeholder.unavailable, hiddenByHost: 'hiddenByHost' in placeholder! && placeholder.hiddenByHost, id: placeholder!.id })
  }
  await service.hide(as('ada'), gist, first.id, false)
  assert.equal((await service.get(as('chi'), gist, first.id)).text, 'rude words')
})

test('a reply liked in the Gist counts once, and the like can be taken back', async () => {
  const first = await say('bayo', 'like me')
  await service.like(as('chi'), gist, first.id)
  await service.like(as('chi'), gist, first.id)
  assert.equal((await service.get(as('dayo'), gist, first.id)).likeCount, 1)
  await service.unlike(as('chi'), first.id)
  assert.equal((await service.get(as('dayo'), gist, first.id)).likeCount, 0)
  assert.equal(await codeOf(service.like(as('outsider'), gist, first.id)), 'not_found')
})

test('a moderator who takes a reply down leaves the ordinary placeholder, not the hidden one', async () => {
  await moderation.setSiteModerator('sam', true)
  const first = await say('bayo', 'against the rules')
  await say('chi', 'a fair answer', first.id)
  await moderation.report(id.dayo, { postId: first.id }, 'harassment', '')
  const [item] = await moderation.queue(id.sam)
  await moderation.resolve(id.sam, item!.id, 'remove_post', 'rules')
  const [placeholder] = (await service.list(as('dayo'), gist, { order: 'newest' })).replies
  assert.equal('unavailable' in placeholder! && placeholder.unavailable, true)
  assert.equal('hiddenByHost' in placeholder!, false)
  assert.equal((await service.branch(as('dayo'), gist, first.id, { order: 'newest' })).replies.length, 1)
})

test('a Gist whose host erased their account is gone, with its replies', async () => {
  await say('bayo', 'hello')
  await db.update(members).set({ deletedAt: new Date() }).where(eq(members.id, id.ada))
  assert.equal(await codeOf(service.list(as('bayo'), gist, { order: 'newest' })), 'not_found')
  assert.equal(await codeOf(gistsService.get(as('bayo'), gist)), 'not_found')
  assert.equal((await db.select().from(posts)).length, 1)
})

test('a reply never notifies, by mention or reply, someone who cannot open the Gist', async () => {
  await db.insert(gistMembers).values({ gistId: gist, memberId: id.chi, role: 'listener', removedAt: new Date() })
  await db.insert(blocks).values({ blockerId: id.dayo, blockedId: id.ada })
  await say('bayo', 'hello @outsider @chi @dayo @sam')
  assert.deepEqual(await told('outsider'), [])
  assert.deepEqual(await told('chi'), [])
  assert.deepEqual(await told('dayo'), [])
  assert.deepEqual(await told('sam'), ['mention'])
  assert.deepEqual(await told('ada'), ['reply'])
})

test('a reply to a reply whose author lost access to the Gist does not notify them', async () => {
  const first = await say('chi', 'my take')
  await db.insert(gistMembers).values({ gistId: gist, memberId: id.chi, role: 'listener', removedAt: new Date() })
  await say('bayo', 'a quote of your take', first.id)
  assert.deepEqual(await told('chi'), [])
})

test('the host named in a reply to someone else is told of the mention', async () => {
  const first = await say('chi', 'my take')
  await say('bayo', 'thanks @ada', first.id)
  assert.deepEqual((await told('ada')).sort(), ['mention', 'reply'])
  assert.deepEqual(await told('chi'), ['reply'])
})

test('a reply with a link asks for a preview, behind the linkPreviews flag', async () => {
  await say('bayo', 'no link here')
  assert.deepEqual(requested, [])
  await say('bayo', 'read https://example.com/jollof today')
  assert.deepEqual(requested, ['https://example.com/jollof'])
  previewsOn = false
  await say('bayo', 'and https://example.com/other')
  assert.equal(requested.length, 1)
})

test('liking a reply tells its author, once, and not one who can no longer open the Gist', async () => {
  const first = await say('bayo', 'like me')
  await service.like(as('chi'), gist, first.id)
  assert.deepEqual(await told('bayo'), ['like'])
  await db.delete(notifications)
  await db.insert(gistMembers).values({ gistId: gist, memberId: id.bayo, role: 'listener', removedAt: new Date() })
  await service.like(as('dayo'), gist, first.id)
  assert.deepEqual(await told('bayo'), [])
})
