import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, ideas, members, notifications, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { linesFor } from '../email/digest.js'
import { ExportService } from '../export/export.service.js'
import { NotificationsService } from '../notifications/notifications.service.js'
import { POST_MAX_GRAPHEMES, PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import {
  BadDuplicateError,
  BOARD_COMMUNITY,
  boardQuery,
  IdeaClosedError,
  IdeasService,
  NotABoardModeratorError,
  newIdea,
  statusChange,
} from './ideas.service.js'

const postsService = new PostsService(db)
const service = new IdeasService(db, postsService)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()
const mod = randomUUID() // moderates Building HeyNaija
const site = randomUUID() // moderates the whole site
const board = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
    { id: mod, handle: 'mod' },
    { id: site, handle: 'site', role: 'moderator' },
  ])
  await db.insert(communities).values({ id: board, slug: BOARD_COMMUNITY, name: 'Building HeyNaija', description: 'The app' })
  await db.insert(communityMemberships).values({ communityId: board, memberId: mod, role: 'moderator' })
})
after(() => pool.end())

const send = (memberId: string, title: string, rest: Partial<Parameters<typeof newIdea.parse>[0]> = {}) =>
  service.create(memberId, newIdea.parse({ kind: 'idea', title, ...rest })).then((r) => r.id)
const list = async (viewer: string | null, query: Record<string, unknown> = {}) =>
  (await service.board(viewer, boardQuery.parse(query))).ideas.map((i) => `${i.title} (${i.votes})`)
const setStatus = (who: string, id: string, change: Record<string, unknown>) => service.setStatus(who, id, statusChange.parse(change))

test('a member sends an idea: a post in Building HeyNaija, title first, with their own vote, under review', async () => {
  // ada never joined Building HeyNaija; the board is open to every member.
  const id = await send(ada, 'Dark mode for the composer', { details: 'It is bright at night.' })
  const [post] = await db.select().from(posts).where(eq(posts.id, id))
  assert.equal(post!.text, 'Dark mode for the composer\n\nIt is bright at night.')
  assert.equal(post!.communityId, board)

  const idea = (await service.get(ada, id))!
  assert.equal(idea.title, 'Dark mode for the composer')
  assert.equal(idea.status, 'under_review')
  assert.equal(idea.votes, 1)
  assert.equal(idea.viewerVoted, true)
  assert.deepEqual(idea.timeline.map((t) => t.status), ['under_review'])
  assert.equal(idea.viewerCanModerate, false)
  assert.equal(idea.problem, null)
  // It is an ordinary post too: in Latest and the community.
  assert.ok((await postsService.feed(null, 10)).posts.some((p) => p.id === id))
})

test('a title is one clean line of at most 80 characters, and with its details fits in a post', () => {
  assert.equal(newIdea.parse({ kind: 'idea', title: '  Two\nlines‮  ' }).title, 'Two lines')
  assert.equal(newIdea.safeParse({ kind: 'idea', title: '   ' }).success, false)
  assert.equal(newIdea.safeParse({ kind: 'idea', title: 'x'.repeat(81) }).success, false)
  // The post is the title, a blank line, then the details: 80 + 2 + the rest of the post limit.
  const room = POST_MAX_GRAPHEMES - 82
  assert.equal(newIdea.safeParse({ kind: 'idea', title: 'x'.repeat(80), details: 'y'.repeat(room) }).success, true)
  assert.equal(newIdea.safeParse({ kind: 'idea', title: 'x'.repeat(80), details: 'y'.repeat(room + 1) }).success, false)
  assert.equal(newIdea.safeParse({ kind: 'question', title: 'What?' }).success, false)
})

test('one vote each, separate from likes; taken back at will; counted from active members; closed ideas take no new ones', async () => {
  const id = await send(ada, 'Offline drafts')
  assert.equal(await service.vote(bayo, id, true), true)
  assert.equal(await service.vote(bayo, id, true), true)
  await service.vote(chi, id, true)
  assert.equal((await service.get(null, id))!.votes, 3)
  assert.equal((await postsService.post(null, id))!.likeCount, 0)

  await service.vote(bayo, id, false)
  assert.equal((await service.get(bayo, id))!.viewerVoted, false)
  await db.update(members).set({ active: false }).where(eq(members.id, chi))
  assert.equal((await service.get(null, id))!.votes, 1)

  await setStatus(mod, id, { status: 'shipped' })
  await assert.rejects(service.vote(bayo, id, true), IdeaClosedError)
  assert.equal(await service.vote(ada, id, false), true)
  assert.equal(await service.vote(ada, randomUUID(), true), false)
})

test('the board lists open, shipped or closed ideas, ideas or problems, by votes or newest, a page at a time', async () => {
  const quiet = await send(ada, 'Quiet idea')
  const popular = await send(bayo, 'Popular idea')
  await service.vote(chi, popular, true)
  const problem = await send(chi, 'Images fail on 3G', { kind: 'problem' })
  const done = await send(ada, 'Done idea')
  await setStatus(mod, done, { status: 'shipped' })
  const later = await send(bayo, 'Later idea')
  await setStatus(mod, later, { status: 'not_now', reason: 'Not for the pilot.' })

  assert.deepEqual(await list(null), ['Popular idea (2)', 'Images fail on 3G (1)', 'Quiet idea (1)'])
  assert.deepEqual(await list(null, { sort: 'new' }), ['Images fail on 3G (1)', 'Popular idea (2)', 'Quiet idea (1)'])
  assert.deepEqual(await list(null, { kind: 'problem' }), ['Images fail on 3G (1)'])
  assert.deepEqual(await list(null, { group: 'shipped' }), ['Done idea (1)'])
  assert.deepEqual(await list(null, { group: 'closed' }), ['Later idea (1)'])

  const first = await service.board(null, boardQuery.parse({ limit: 2 }))
  assert.equal(first.ideas.length, 2)
  const rest = await service.board(null, boardQuery.parse({ limit: 2, cursor: first.cursor }))
  assert.deepEqual(rest.ideas.map((i) => i.id), [quiet])
  assert.equal(rest.cursor, null)
  assert.ok(problem && popular)
})

test("only Building HeyNaija's moderators, or the site's, set statuses; not now and duplicate say why", async () => {
  const id = await send(ada, 'Polls in posts')
  await assert.rejects(setStatus(ada, id, { status: 'planned' }), NotABoardModeratorError)
  await assert.rejects(setStatus(bayo, id, { status: 'planned' }), NotABoardModeratorError)
  assert.equal(await setStatus(mod, id, { status: 'planned' }), true)
  assert.equal(await setStatus(site, id, { status: 'in_progress', reason: 'Started this week.' }), true)
  assert.equal(await setStatus(mod, randomUUID(), { status: 'planned' }), false)

  assert.equal(statusChange.safeParse({ status: 'not_now' }).success, false)
  assert.equal(statusChange.safeParse({ status: 'duplicate', reason: 'Same as polls' }).success, false)
  assert.equal(statusChange.safeParse({ status: 'planned', duplicateOf: randomUUID() }).success, false)
  assert.equal(statusChange.safeParse({ status: 'wontfix' }).success, false)

  const idea = (await service.get(mod, id))!
  assert.equal(idea.viewerCanModerate, true)
  assert.deepEqual(
    idea.timeline.map((t) => [t.status, t.reason]),
    [['under_review', null], ['planned', null], ['in_progress', 'Started this week.']],
  )
  assert.equal(idea.statusReason, 'Started this week.')
})

test('a status change tells the author and everyone who voted, but not the moderator who made it', async () => {
  const id = await send(ada, 'Voice notes', { kind: 'problem' })
  await service.vote(bayo, id, true)
  await service.vote(mod, id, true)
  await setStatus(mod, id, { status: 'planned' })

  const told = await db
    .select({ to: notifications.recipientId, detail: notifications.detail, actor: notifications.actorId })
    .from(notifications)
    .where(eq(notifications.kind, 'idea_status'))
  assert.deepEqual(new Set(told.map((n) => n.to)), new Set([ada, bayo]))
  assert.ok(told.every((n) => n.detail === 'planned' && n.actor === null))

  const notifier = new NotificationsService(db)
  const [mine] = (await notifier.list(ada, 10)).notifications
  assert.deepEqual(mine!.idea, { kind: 'problem', yours: true })
  assert.equal(mine!.detail, 'planned')
  const [theirs] = (await notifier.list(bayo, 10)).notifications
  assert.deepEqual(theirs!.idea, { kind: 'problem', yours: false })

  // In an email or a push: "The problem you reported is now planned", quoting it.
  const [line] = linesFor([{ kind: 'idea_status', actor: null, postId: id, excerpt: 'Voice notes', community: null, idea: { status: 'planned', kind: 'problem', yours: true } }], 'https://heynaija.ng')
  assert.equal(line!.headline, 'The problem you reported is now planned')
  assert.equal(line!.quote, 'Voice notes')
  assert.equal(line!.href, `https://heynaija.ng/p/${id}`)
})

test("a duplicate's votes move to the original, and a duplicate cannot be anyone's original", async () => {
  const original = await send(ada, 'Edit posts')
  const copy = await send(bayo, 'Let me edit my posts')
  await service.vote(chi, copy, true)
  await service.vote(ada, copy, true)
  await setStatus(mod, copy, { status: 'duplicate', reason: 'Same as Edit posts', duplicateOf: original })

  // ada had voted for both: still one vote. bayo and chi move over.
  assert.equal((await service.get(null, original))!.votes, 3)
  const marked = (await service.get(null, copy))!
  assert.equal(marked.votes, 0)
  assert.deepEqual(marked.duplicateOf, { id: original, title: 'Edit posts' })
  assert.deepEqual(await list(null, { group: 'closed' }), ['Let me edit my posts (0)'])

  const third = await send(chi, 'Editing')
  await assert.rejects(setStatus(mod, third, { status: 'duplicate', reason: 'Same', duplicateOf: copy }), BadDuplicateError)
  await assert.rejects(setStatus(mod, third, { status: 'duplicate', reason: 'Same', duplicateOf: third }), BadDuplicateError)
  await assert.rejects(setStatus(mod, third, { status: 'duplicate', reason: 'Same', duplicateOf: randomUUID() }), BadDuplicateError)
  // Reopening a duplicate clears its original.
  await setStatus(mod, copy, { status: 'under_review' })
  const [row] = await db.select().from(ideas).where(eq(ideas.postId, copy))
  assert.equal(row!.duplicateOf, null)
})

test("where a problem happened is seen only by its reporter and the board's moderators", async () => {
  const id = await send(ada, 'The feed is blank', {
    kind: 'problem',
    page: '/?feed=discover',
    browser: 'Chrome on Android',
    appVersion: 'abc123',
  })
  const details = { page: '/?feed=discover', browser: 'Chrome on Android', appVersion: 'abc123' }
  assert.deepEqual((await service.get(ada, id))!.problem, details)
  assert.deepEqual((await service.get(mod, id))!.problem, details)
  assert.deepEqual((await service.get(site, id))!.problem, details)
  assert.equal((await service.get(bayo, id))!.problem, null)
  assert.equal((await service.get(null, id))!.problem, null)
  // An idea never carries them.
  const idea = await send(ada, 'Not a problem', { page: '/somewhere' })
  assert.equal((await service.get(ada, idea))!.problem, null)

  // The reporter's data export has them; the post itself does not.
  const data = (await new ExportService(db).export(ada, null))!
  assert.deepEqual(
    data.ideas.map((i) => [i.title, i.kind, i.page]),
    [['The feed is blank', 'problem', '/?feed=discover'], ['Not a problem', 'idea', null]],
  )
  assert.deepEqual(new Set(data.ideaVotes.map((v) => v.postId)), new Set([id, idea]))
  assert.ok(!(await postsService.post(null, id))!.text.includes('Chrome'))
})

test('similar ideas are found from the words being typed', async () => {
  await send(ada, 'Dark mode for the composer')
  await send(bayo, 'Offline drafts', { details: 'Keep what I typed when the network drops.' })
  await send(chi, 'Notifications are late')

  const titles = async (q: string) => (await service.similar(null, q)).map((i) => i.title)
  assert.deepEqual(await titles('dark'), ['Dark mode for the composer'])
  assert.deepEqual(await titles('netw'), ['Offline drafts'])
  assert.deepEqual(new Set(await titles('dark notif')), new Set(['Dark mode for the composer', 'Notifications are late']))
  assert.deepEqual(await titles('a b'), [])
  // Only letters and digits reach the query, so this is three harmless words.
  assert.deepEqual(await titles("'); delete from ideas; --"), [])
  assert.equal((await db.select().from(ideas)).length, 3)
})

test('a deleted idea leaves the board, and authors the reader blocked are not on it', async () => {
  const gone = await send(ada, 'Deleted idea')
  await send(bayo, 'Blocked idea')
  await send(chi, 'Visible idea')
  await postsService.remove(ada, gone)
  await db.insert(blocks).values({ blockerId: chi, blockedId: bayo })

  assert.deepEqual(await list(chi), ['Visible idea (1)'])
  assert.equal(await service.get(null, gone), null)
  assert.equal(await service.get(chi, (await db.select().from(posts).where(eq(posts.authorId, bayo)))[0]!.id), null)
})
