import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, communities, communityMemberships, competitionEntries, competitions, gameEvents, kenoRounds, kenoTickets, members, posts, xpTotals } from '@heynaija/db'
import { and, eq } from 'drizzle-orm'
import { NotACommunityMemberError, PostsService } from '../../posts/posts.service.js'
import { db, migrate, pool, reset } from '../../test-db.js'
import { ARBITER_ID, GAME_NIGHT_SLUG } from '../chess/arena-ids.js'
import { ensureArena } from '../chess/arena-setup.js'
import { TokenBox } from '../core/token-box.js'
import { drawNumbers } from '../keno/draw.js'
import { KenoService } from '../keno/keno.service.js'
import { CompetitionError, type CompetitionInput, CompetitionsService, placings } from './competitions.js'

const env = { WEB_PUBLIC_URL: 'https://heynaija.test', LICHESS_URL: 'https://lichess.test' }
let gamesOn = true
const flags = { onForAnyone: async () => gamesOn }
const postsService = new PostsService(db)
const box = new TokenBox('f'.repeat(64))

let service: CompetitionsService
let keno: KenoService
const sam = randomUUID() // a site moderator
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

// 3 November 2026: entry opens at 09:00 UTC, play runs 09:00 to 09:30.
const at = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00Z`)
const input = (over: Partial<CompetitionInput> = {}): CompetitionInput => ({
  name: 'Tuesday Keno Cup',
  game: 'keno',
  format: 'keno_points',
  eligibility: 'open',
  entryOpensAt: at('09:00'),
  entryClosesAt: at('09:20'),
  startsAt: at('09:00'),
  endsAt: at('09:30'),
  ...over,
})

before(migrate)
beforeEach(async () => {
  await reset()
  gamesOn = true
  await db.insert(members).values([
    { id: sam, handle: 'sam', role: 'moderator' },
    { id: ada, handle: 'ada', displayName: 'Ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo' },
    { id: chi, handle: 'chi' },
  ])
  await ensureArena(db)
  service = new CompetitionsService(db, env, flags, postsService)
  keno = new KenoService(db, { KENO_DRAW_EVERY_MS: 300_000, KENO_DAILY_TOKENS: 20 }, box, flags)
})
after(() => pool.end())

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof CompetitionError) return err.code
    throw err
  }
  assert.fail('expected a CompetitionError')
}

test('places: by score, ties sharing a place, and only those who played', () => {
  const p = placings([
    { memberId: 'a', score: 50 },
    { memberId: 'b', score: 80 },
    { memberId: 'c', score: 50 },
    { memberId: 'd', score: 10 },
    { memberId: 'e', score: null },
  ])
  assert.deepEqual(Object.fromEntries(p), { b: 1, a: 2, c: 2, d: 4 })
})

test('only site moderators make, change, publish and cancel competitions; details are checked', async () => {
  assert.equal(await refusal(() => service.create(ada, input(), true)), 'not_moderator')
  assert.equal(await refusal(() => service.create(sam, input({ game: 'chess', format: 'keno_points' }), true)), 'invalid', 'no chess competitions yet')
  assert.equal(await refusal(() => service.create(sam, input({ endsAt: at('08:00') }), true)), 'invalid')
  assert.equal(await refusal(() => service.create(sam, input({ entryClosesAt: at('10:00') }), true)), 'invalid', 'entry closes before the end')
  assert.equal(await refusal(() => service.create(sam, input({ eligibility: 'community', community: 'nowhere' }), true)), 'invalid')
  assert.equal(await refusal(() => service.create(sam, input({ eligibility: 'invite', invite: ['@nobody_here'] }), true)), 'invalid')

  const id = await service.create(sam, input(), false, at('08:00'))
  assert.equal((await service.view(sam, id, at('08:00'))).status, 'draft')
  assert.equal(await refusal(() => service.view(ada, id, at('08:00'))), 'not_found', 'drafts are for moderators')
  assert.deepEqual((await service.list(ada)).current, [])
  await service.update(sam, id, input({ name: 'Tuesday Keno Cup II' }), at('08:00'))
  await service.publish(sam, id, at('08:00'))
  const view = await service.view(ada, id, at('08:00'))
  assert.deepEqual([view.name, view.status], ['Tuesday Keno Cup II', 'open'])
  assert.equal(await refusal(() => service.update(sam, id, input(), at('09:05'))), 'not_editable', 'not once entry is open')
  await service.cancel(sam, id)
  assert.equal(await refusal(() => service.cancel(sam, id)), 'not_editable')
})

test('entering: only while entry is open, and only if eligible (open, community, invite)', async () => {
  const open = await service.create(sam, input(), true, at('08:00'))
  assert.equal(await refusal(() => service.enter(ada, open, at('08:30'))), 'entry_closed', 'not open yet')
  await service.enter(ada, open, at('09:10'))
  await service.enter(ada, open, at('09:11'))
  assert.equal((await service.view(ada, open, at('09:12'))).you.entered, true)
  assert.equal(await refusal(() => service.enter(bayo, open, at('09:25'))), 'entry_closed')
  assert.equal(await refusal(() => service.withdraw(ada, open, at('09:25'))), 'entry_closed', 'in it to the end once entry closes')
  await service.withdraw(ada, open, at('09:15'))
  assert.equal((await service.view(ada, open, at('09:15'))).entrants, 0)

  const [c] = await db.insert(communities).values({ slug: 'yaba-players', name: 'Yaba Players', description: 'x' }).returning()
  await db.insert(communityMemberships).values({ communityId: c!.id, memberId: bayo })
  const local = await service.create(sam, input({ eligibility: 'community', community: 'yaba-players' }), true, at('08:00'))
  assert.equal(await refusal(() => service.enter(ada, local, at('09:10'))), 'not_eligible')
  await service.enter(bayo, local, at('09:10'))

  const invited = await service.create(sam, input({ eligibility: 'invite', invite: ['@Chi'] }), true, at('08:00'))
  assert.equal(await refusal(() => service.enter(ada, invited, at('09:10'))), 'not_eligible')
  await service.enter(chi, invited, at('09:10'))
  assert.deepEqual((await service.view(sam, invited, at('09:10'))).invite, ['chi'])
})

/** Plays a Keno ticket that matches `hits` of the round's drawn numbers, knowing its seed (tests only). */
async function ticket(memberId: string, now: Date, hits: number) {
  await keno.ensureRounds(now)
  const played = await keno.play(memberId, [1], now)
  const [round] = await db.select().from(kenoRounds).where(eq(kenoRounds.number, played.round))
  const drawn = drawNumbers(box.open(round!.seedSealed, `keno-round:${round!.drawsAt.toISOString()}`), round!.number)
  const missed = Array.from({ length: 80 }, (_, i) => i + 1).filter((n) => !drawn.includes(n))
  await db.update(kenoTickets).set({ numbers: [...drawn.slice(0, hits), ...missed.slice(0, 4 - hits)] }).where(eq(kenoTickets.id, played.id))
}

test('live scores come from Keno rounds drawn in the window; it finishes with places, XP and The Arbiter’s post in Game Night', async () => {
  const id = await service.create(sam, input(), true, at('08:00'))
  await service.enter(ada, id, at('09:00'))
  await service.enter(bayo, id, at('09:00'))
  await service.enter(chi, id, at('09:00')) // enters, never plays
  assert.deepEqual(await service.tick(at('09:01')), [])
  assert.equal((await service.view(ada, id, at('09:01'))).status, 'live')

  await ticket(ada, at('09:01'), 4) // 4 of 4: 100 points, round at 09:05
  await ticket(bayo, at('09:01'), 3) // 3 of 4: 5 points
  await ticket(chi, at('08:10'), 4) // a round drawn before the start (08:15) does not count
  await keno.tick(at('08:16'))
  await keno.tick(at('09:06'))
  const live = await service.view(bayo, id, at('09:06'))
  assert.deepEqual(live.standings.map((s) => [s.handle, s.place, s.score]), [['ada', 1, 100], ['bayo', 2, 5], ['chi', null, null]])
  assert.deepEqual([live.yourStanding!.handle, live.yourStanding!.place], ['bayo', 2])

  // Not finished until its time is up and every round before the end is drawn.
  await ticket(ada, at('09:24'), 0) // into the 09:25 round, still inside the window
  assert.deepEqual(await service.tick(at('09:29')), [])
  assert.deepEqual(await service.tick(at('09:31')), [], 'the 09:25 round is not drawn yet')
  await keno.tick(at('09:31'))
  const [finished] = await service.tick(at('09:31'))
  assert.equal(finished, id)
  assert.deepEqual(await service.tick(at('09:32')), [], 'once')

  const entries = await db.select().from(competitionEntries).where(eq(competitionEntries.competitionId, id))
  assert.deepEqual(Object.fromEntries(entries.map((e) => [e.memberId, e.placement])), { [ada]: 1, [bayo]: 2, [chi]: null })
  const placed = await db.select().from(gameEvents).where(eq(gameEvents.kind, 'competition_placed'))
  assert.deepEqual(Object.fromEntries(placed.map((e) => [e.memberId, e.xp])), { [ada]: 105, [bayo]: 65 }, 'nobody who did not play')
  const [score] = await db.select().from(xpTotals).where(and(eq(xpTotals.memberId, ada), eq(xpTotals.period, '2026-11')))
  assert.ok(score!.xp >= 105)

  const [c] = await db.select().from(competitions).where(eq(competitions.id, id))
  assert.equal(c!.status, 'finished')
  const [post] = await db.select().from(posts).where(eq(posts.id, c!.resultPostId!))
  assert.equal(post!.authorId, ARBITER_ID)
  const [night] = await db.select().from(communities).where(eq(communities.slug, GAME_NIGHT_SLUG))
  assert.equal(post!.communityId, night!.id)
  assert.match(post!.text, /Tuesday Keno Cup is over/)
  assert.match(post!.text, /1\. Ada · 100 points\n2\. Bayo · 5 points/)
  assert.match(post!.text, /2 members took part/)
  assert.ok(!post!.text.includes('@'), 'names, not @handles: nobody is pinged')
})

test('a community competition posts in its community; one nobody played finishes with no post; nothing moves while Games is off', async () => {
  const [c] = await db.insert(communities).values({ slug: 'yaba-players', name: 'Yaba Players', description: 'x' }).returning()
  await db.insert(communityMemberships).values({ communityId: c!.id, memberId: ada })
  const local = await service.create(sam, input({ eligibility: 'community', community: 'yaba-players' }), true, at('08:00'))
  const empty = await service.create(sam, input({ name: 'Nobody came' }), true, at('08:00'))
  await service.enter(ada, local, at('09:00'))
  await ticket(ada, at('09:01'), 2)
  await keno.tick(at('09:31'))

  gamesOn = false
  assert.deepEqual(await service.tick(at('09:31')), [])
  gamesOn = true
  assert.deepEqual((await service.tick(at('09:31'))).sort(), [local, empty].sort())
  const [l] = await db.select().from(competitions).where(eq(competitions.id, local))
  const [post] = await db.select().from(posts).where(eq(posts.id, l!.resultPostId!))
  assert.equal(post!.communityId, c!.id)
  const [e] = await db.select().from(competitions).where(eq(competitions.id, empty))
  assert.deepEqual([e!.status, e!.resultPostId], ['finished', null])
})

test('standings hide members blocked either way, but the viewer always sees themselves', async () => {
  const id = await service.create(sam, input(), true, at('08:00'))
  for (const m of [ada, bayo, chi]) await service.enter(m, id, at('09:00'))
  await db.insert(blocks).values({ blockerId: bayo, blockedId: ada })
  const forAda = await service.view(ada, id, at('09:01'))
  assert.deepEqual(forAda.standings.map((s) => s.handle).sort(), ['ada', 'chi'])
  assert.equal(forAda.entrants, 3)
})

test('Game Night: only The Arbiter starts posts there; members reply', async () => {
  await assert.rejects(() => postsService.create(ada, 'hello', { communitySlug: GAME_NIGHT_SLUG, anyMember: true }), NotACommunityMemberError)
  const { id } = await postsService.create(ARBITER_ID, 'Results', { communitySlug: GAME_NIGHT_SLUG, anyMember: true })
  await postsService.create(ada, 'Well played!', { replyTo: id })
})
