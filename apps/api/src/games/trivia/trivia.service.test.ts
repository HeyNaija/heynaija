import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, media, members, notifications, posts, seasonScores, triviaAnswers, triviaQuestions, triviaResults, triviaRounds, xpTotals } from '@heynaija/db'
import { and, asc, eq, sql } from 'drizzle-orm'
import { PostsService } from '../../posts/posts.service.js'
import { db, giveBirthDates, migrate, pool, reset } from '../../test-db.js'
import { ensureArena } from '../chess/arena-setup.js'
import { REVIEW_MS, type RoundInput, TriviaError, TriviaService } from './trivia.service.js'

const env = { WEB_PUBLIC_URL: 'https://heynaija.test' }
let triviaOn = true
const flags = { onForAnyone: async () => triviaOn }
const postsService = new PostsService(db)
let trivia: TriviaService

const sam = randomUUID() // a site moderator, an adult by stated age
const mod = randomUUID() // a site moderator with no age on record
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID() // under 18

before(migrate)
beforeEach(async () => {
  await reset()
  triviaOn = true
  await db.insert(members).values([
    { id: sam, handle: 'sam', role: 'moderator' },
    { id: mod, handle: 'mod', role: 'moderator' },
    { id: ada, handle: 'ada', displayName: 'Ada' },
    { id: bayo, handle: 'bayo', displayName: 'Bayo' },
    { id: chi, handle: 'chi', displayName: 'Chidi' },
  ])
  await giveBirthDates([sam])
  await giveBirthDates([chi], 15)
  await ensureArena(db)
  trivia = new TriviaService(db, env, flags, postsService)
})
after(() => pool.end())

const refusal = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof TriviaError) return err.code
    throw err
  }
  assert.fail('expected a TriviaError')
}

const input = (over: Partial<RoundInput> = {}): RoundInput => ({
  title: 'Anime Trivia Night',
  // Far ahead, so it never becomes a time that has passed.
  startsAt: new Date('2030-11-24T19:00:00Z'),
  secondsPerQuestion: 20,
  autoAdvance: false,
  questions: [
    { kind: 'choice', prompt: 'Who writes in the Death Note first?', choices: ['Light', 'L', 'Ryuk', 'Misa'], correctChoice: 0, explanation: 'Light Yagami finds it.' },
    { kind: 'typed', prompt: 'Name the titan-fighting anime.', accepted: ['Attack on Titan', 'Shingeki no Kyojin'] },
  ],
  ...over,
})

const questionsOf = (roundId: string) => db.select().from(triviaQuestions).where(eq(triviaQuestions.roundId, roundId)).orderBy(asc(triviaQuestions.position))

/** Brings the countdown forward: the question is open now, for ten more seconds. */
const openNow = (id: string) => db.execute(sql`update games.trivia_questions set opens_at = clock_timestamp() - interval '1 second', closes_at = clock_timestamp() + interval '10 seconds' where id = ${id}`)
/** Time runs out now. */
const closeNow = (id: string) => db.execute(sql`update games.trivia_questions set opens_at = clock_timestamp() - interval '5 seconds', closes_at = clock_timestamp() - interval '1 millisecond' where id = ${id}`)

/** A round on the schedule with its first question open. */
async function running(over: Partial<RoundInput> = {}) {
  const id = await trivia.create(sam, input(over))
  await trivia.publish(sam, id)
  await trivia.open(sam, id)
  const qs = await questionsOf(id)
  await openNow(qs[0]!.id)
  return { id, qs }
}

test('only site moderators who are adults by their stated age host, and a round must make sense', async () => {
  assert.equal(await trivia.mayHost(sam), true)
  assert.equal(await trivia.mayHost(mod), false, 'no age on record')
  assert.equal(await trivia.mayHost(ada), false)
  assert.equal(await refusal(() => trivia.create(ada, input())), 'not_host')
  assert.equal(await refusal(() => trivia.create(sam, input({ questions: [{ kind: 'choice', prompt: 'Q?', choices: ['A'], correctChoice: 0 }] }))), 'invalid')
  assert.equal(await refusal(() => trivia.create(sam, input({ questions: [{ kind: 'choice', prompt: 'Q?', choices: ['A', 'B'], correctChoice: 3 }] }))), 'invalid')
  assert.equal(await refusal(() => trivia.create(sam, input({ questions: [{ kind: 'typed', prompt: 'Q?', accepted: ['  '] }] }))), 'invalid')
  assert.equal(await refusal(() => trivia.create(sam, input({ secondsPerQuestion: 5 }))), 'invalid')
})

test('a draft is the host’s alone; publishing it puts The Arbiter’s thread in Game Night', async () => {
  const id = await trivia.create(sam, input())
  assert.equal(await trivia.view(ada, id), null)
  await trivia.publish(sam, id)
  const [round] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(round!.status, 'scheduled')
  const [thread] = await db.select().from(posts).where(eq(posts.id, round!.threadPostId!))
  assert.match(thread!.text, /^Anime Trivia Night: Sunday, 24 November at 20:00 Lagos time\./)
  // After midnight the hour has two digits: "at 00:05".
  await trivia.update(sam, id, input({ startsAt: new Date('2030-11-24T23:05:00Z') }))
  const [update] = await db.select().from(posts).where(eq(posts.storyId, round!.threadPostId!))
  assert.match(update!.text, /Monday, 25 November at 00:05 Lagos time/)
  assert.match(thread!.text, /https:\/\/heynaija\.test\/games\/trivia\/rounds\//)
  const list = await trivia.list(ada)
  assert.deepEqual(list.upcoming.map((r) => r.id), [id])
  assert.equal(list.mayHost, false)
})

test('a start time that has passed is refused; changing a scheduled round reaches open pages and its thread, never another community', async () => {
  const gone = new Date(Date.now() - 60 * 60_000)
  assert.equal(await refusal(() => trivia.create(sam, input({ startsAt: gone }))), 'invalid')
  // A round set to start a minute ago is a round run now.
  const now = await trivia.create(sam, input({ startsAt: new Date(Date.now() - 60_000) }))
  // A draft whose time went by while it waited cannot be announced.
  await db.update(triviaRounds).set({ startsAt: gone }).where(eq(triviaRounds.id, now))
  assert.equal(await refusal(() => trivia.publish(sam, now)), 'invalid')

  const id = await trivia.create(sam, input())
  await trivia.publish(sam, id)
  const [before] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(await refusal(() => trivia.update(sam, id, input({ startsAt: gone }))), 'invalid')
  const replies = () => db.select().from(posts).where(eq(posts.replyParentId, before!.threadPostId!))
  const updates = () => db.select().from(posts).where(eq(posts.storyId, before!.threadPostId!))

  const later = new Date('2030-11-25T20:30:00Z')
  await trivia.update(sam, id, input({ startsAt: later }))
  const [moved] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(moved!.startsAt.getTime(), later.getTime())
  assert.ok(moved!.version > before!.version, 'open pages are woken')
  assert.equal(new Date((await trivia.view(ada, id))!.startsAt).getTime(), later.getTime())
  // Posts are never edited, so The Arbiter says what changed: a new time is an
  // update to the announcement's story, so it reaches feeds and the story's followers.
  assert.deepEqual((await updates()).map((p) => p.text), ['Update: Anime Trivia Night is now on Monday, 25 November at 21:30 Lagos time. 2 questions, 20 seconds each.'])
  assert.equal((await replies()).length, 0)

  // Changing only a question's note tells nobody anything new.
  const [first, second] = input().questions
  await trivia.update(sam, id, input({ startsAt: later, questions: [{ ...first!, explanation: 'Light finds it in a schoolyard.' }, second!] }))
  assert.equal((await updates()).length + (await replies()).length, 1)
  // A new title at the same time is only a reply.
  await trivia.update(sam, id, input({ title: 'Anime Trivia Night 2', startsAt: later }))
  assert.deepEqual((await replies()).map((p) => p.text), ['Update: Anime Trivia Night 2 is now on Monday, 25 November at 21:30 Lagos time. 2 questions, 20 seconds each.'])
  assert.equal((await updates()).length, 1)
  // The thread is in Game Night, so the round stays there.
  assert.equal(await refusal(() => trivia.update(sam, id, input({ startsAt: later, community: 'chess-arena' }))), 'not_editable')
  // A draft can still go anywhere.
  const draft = await trivia.create(sam, input())
  await trivia.update(sam, draft, input({ community: 'chess-arena' }))
})

test('a question can have a picture: a ready one the host uploaded, hidden until it opens, then on The Arbiter’s update', async () => {
  const upload = async (owner: string, status: 'ready' | 'processing' = 'ready') =>
    (
      await db
        .insert(media)
        .values({ ownerId: owner, kind: 'post_image', status, contentType: 'image/webp', bytes: 1000, width: 800, height: 600, readyAt: status === 'ready' ? new Date() : null })
        .returning({ id: media.id })
    )[0]!.id
  const [first, second] = input().questions
  const pictured = (image: { id: string; alt: string }) => input({ questions: [{ ...first!, image }, second!] })
  const mine = await upload(sam)
  assert.equal(await refusal(() => trivia.create(sam, pictured({ id: mine, alt: ' ' }))), 'invalid', 'described for screen readers')
  assert.equal(await refusal(async () => trivia.create(sam, pictured({ id: await upload(sam, 'processing'), alt: 'A notebook' }))), 'invalid', 'still being checked')
  assert.equal(await refusal(async () => trivia.create(sam, pictured({ id: await upload(ada), alt: 'A notebook' }))), 'invalid', 'someone else’s upload')
  const id = await trivia.create(sam, pictured({ id: mine, alt: 'A black notebook' }))
  assert.equal(await refusal(() => trivia.create(sam, pictured({ id: mine, alt: 'Again' }))), 'invalid', 'on one question only')
  const picture = { src: `/media/posts/${mine}`, alt: 'A black notebook', width: 800, height: 600, animated: false }
  assert.deepEqual((await trivia.hostView(sam, id)).questions[0]!.image, { id: mine, ...picture })
  // The round's own picture can be sent again when it is changed.
  await trivia.update(sam, id, pictured({ id: mine, alt: 'A black notebook' }))

  await trivia.publish(sam, id)
  await trivia.open(sam, id)
  const [q1] = await questionsOf(id)
  const counting = (await trivia.view(ada, id))!
  assert.equal(counting.current!.image, null)
  assert.equal(JSON.stringify(counting).includes(mine), false, 'nobody is given its address before the question opens')
  await openNow(q1!.id)
  assert.deepEqual((await trivia.view(ada, id))!.current!.image, picture)
  await closeNow(q1!.id)
  await trivia.judgeDue(id)
  assert.deepEqual((await trivia.view(ada, id))!.last!.image, picture)
  // The Arbiter's update with the answer carries it, so the talk under it shows what was asked.
  const [judged] = await questionsOf(id)
  const [file] = await db.select().from(media).where(eq(media.id, mine))
  assert.equal(file!.postId, judged!.revealPostId)
  assert.equal(file!.alt, 'A black notebook')
})

test('a long-poll answers at once when the page still shows the countdown of a question that has opened', async () => {
  const id = await trivia.create(sam, input())
  await trivia.publish(sam, id)
  await trivia.open(sam, id)
  const [first] = await questionsOf(id)
  const counting = (await trivia.view(ada, id))!
  assert.equal(trivia.answersNow(counting, counting.version, ''), false, 'counting down: wait for it to open')
  await openNow(first!.id)
  const open = (await trivia.view(ada, id))!
  assert.equal(open.version, counting.version, 'opening by the clock is not a new version')
  assert.equal(trivia.answersNow(open, open.version, ''), true, 'the page still shows the countdown')
  assert.equal(trivia.answersNow(open, open.version, first!.id), false, 'the page has it: wait for the next change')
  assert.equal(trivia.answersNow(open, open.version), false, 'an app that does not say waits as before')
  assert.equal(trivia.answersNow(open, open.version - 1, first!.id), true, 'a new version')
  assert.equal(trivia.answersNow(open, -1, first!.id), true, 'no version: at once')
})

test('a question is never sent before it opens, and an answer counts only while it is open, once', async () => {
  const id = await trivia.create(sam, input())
  await trivia.publish(sam, id)
  await trivia.open(sam, id)
  const [first] = await questionsOf(id)
  // Counting down: players know a question is coming, not what it is.
  const waiting = (await trivia.view(ada, id))!
  assert.equal(waiting.current?.id, first!.id)
  assert.equal(waiting.current?.prompt, null)
  assert.equal(waiting.current?.choices, null)
  assert.equal(await refusal(() => trivia.answer(ada, id, first!.id, { choice: 0 })), 'closed')
  assert.equal(await refusal(() => trivia.open(sam, id)), 'busy')

  await openNow(first!.id)
  const open = (await trivia.view(ada, id))!
  assert.equal(open.current?.prompt, 'Who writes in the Death Note first?')
  assert.deepEqual(open.current!.choices!.map((c) => c.id).sort(), [0, 1, 2, 3])
  assert.equal(JSON.stringify(open).includes('"correctChoice"'), false, 'the right answer is not sent')
  const { ms } = await trivia.answer(ada, id, first!.id, { choice: 0 })
  assert.ok(ms >= 1000 && ms < 3000)
  // A choice can be changed while the question is open; the change is the answer's time.
  await new Promise((done) => setTimeout(done, 20))
  const changed = await trivia.answer(ada, id, first!.id, { choice: 1 })
  assert.ok(changed.ms > ms, 'the time moves to the change')
  assert.equal((await trivia.view(ada, id))!.current!.yourAnswer!.choice, 1)
  assert.equal((await trivia.answer(ada, id, first!.id, { choice: 1 })).ms, changed.ms, 'the same choice again keeps its time')
  await trivia.answer(ada, id, first!.id, { choice: 0 })
  assert.equal(await refusal(() => trivia.answer(sam, id, first!.id, { choice: 0 })), 'invalid', 'the host does not play')
  // Another adult site moderator could open the host's view, so does not play either; a moderator under 18 cannot, and does.
  const other = randomUUID()
  await db.insert(members).values({ id: other, handle: 'other_mod', role: 'moderator' })
  await giveBirthDates([other])
  assert.equal(await refusal(() => trivia.answer(other, id, first!.id, { choice: 0 })), 'invalid')
  assert.equal((await trivia.view(other, id))!.you.canAnswer, false)
  assert.equal((await trivia.view(ada, id))!.you.canAnswer, true)
  assert.equal((await trivia.view(ada, id))!.current!.yourAnswer!.choice, 0)

  await closeNow(first!.id)
  assert.equal(await refusal(() => trivia.answer(bayo, id, first!.id, { choice: 0 })), 'closed')
})

test('judging: the first right answers by the server’s clock, points, the reveal and The Arbiter’s update', async () => {
  const { id, qs } = await running()
  await trivia.answer(bayo, id, qs[0]!.id, { choice: 2 }) // wrong
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 })
  await trivia.answer(chi, id, qs[0]!.id, { choice: 0 })
  await closeNow(qs[0]!.id)
  assert.equal(await trivia.judgeDue(id), 1)
  assert.equal(await trivia.judgeDue(id), 0, 'once only')

  const answers = await db.select().from(triviaAnswers).where(eq(triviaAnswers.questionId, qs[0]!.id))
  const of = (m: string) => answers.find((a) => a.memberId === m)!
  assert.deepEqual([of(ada).place, of(ada).points], [1, 15])
  assert.deepEqual([of(chi).place, of(chi).points], [2, 13])
  assert.deepEqual([of(bayo).correct, of(bayo).points], [false, 0])

  const view = (await trivia.view(bayo, id))!
  assert.equal(view.current, null)
  assert.equal(view.last?.answer, 'Light')
  assert.deepEqual(view.last?.firsts.map((f) => f.handle), ['ada', 'chi'])
  assert.equal(view.last?.choices?.find((c) => c.id === 2)?.count, 1)
  assert.equal(view.last?.you?.correct, false)
  assert.deepEqual(view.standings.map((s) => [s.handle, s.points]), [['ada', 15], ['chi', 13], ['bayo', 0]])

  const [q] = await db.select().from(triviaQuestions).where(eq(triviaQuestions.id, qs[0]!.id))
  const [reveal] = await db.select().from(posts).where(eq(posts.id, q!.revealPostId!))
  assert.match(reveal!.text, /Answer: Light/)
  assert.match(reveal!.text, /2 of 3 got it right/)
  // An update to the thread's story, not a reply: the story shows the round question by question.
  const [round] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.deepEqual([reveal!.storyId, reveal!.replyParentId], [round!.threadPostId, null])
})

test('a changed choice counts as it was last left, at the time it was changed', async () => {
  const { id, qs } = await running()
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 }) // right, first
  await trivia.answer(bayo, id, qs[0]!.id, { choice: 0 }) // right, second
  await trivia.answer(chi, id, qs[0]!.id, { choice: 0 }) // right, then changed to wrong
  await trivia.answer(ada, id, qs[0]!.id, { choice: 2 })
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 }) // back to right, but now after bayo
  await trivia.answer(chi, id, qs[0]!.id, { choice: 3 })
  await closeNow(qs[0]!.id)
  assert.equal(await refusal(() => trivia.answer(ada, id, qs[0]!.id, { choice: 1 })), 'closed', 'no changes once time is up')
  await trivia.judgeDue(id)
  const answers = await db.select().from(triviaAnswers).where(eq(triviaAnswers.questionId, qs[0]!.id))
  const of = (m: string) => answers.find((a) => a.memberId === m)!
  assert.deepEqual([of(bayo).place, of(bayo).points], [1, 15])
  assert.deepEqual([of(ada).choice, of(ada).place, of(ada).points], [0, 2, 13])
  assert.deepEqual([of(chi).choice, of(chi).correct, of(chi).points], [3, false, 0])
  const view = (await trivia.view(chi, id))!
  assert.equal(view.last?.you?.choice, 3)
  assert.equal(view.last?.choices?.find((c) => c.id === 0)?.count, 2, 'each member counts once, for their last choice')
})

test('many answers at the same moment still give exactly one first', async () => {
  const { id, qs } = await running()
  const players = Array.from({ length: 30 }, (_, i) => ({ id: randomUUID(), handle: `p${i}` }))
  await db.insert(members).values(players)
  await Promise.all(players.map((p) => trivia.answer(p.id, id, qs[0]!.id, { choice: 0 })))
  await closeNow(qs[0]!.id)
  await trivia.judgeDue(id)
  const places = (await db.select().from(triviaAnswers).where(eq(triviaAnswers.questionId, qs[0]!.id))).map((a) => a.place).sort((a, b) => a! - b!)
  assert.deepEqual(places, Array.from({ length: 30 }, (_, i) => i + 1))
})

test('typed answers: small typos count, the host accepts a spelling, a bad question is voided', async () => {
  const { id, qs } = await running()
  await closeNow(qs[0]!.id)
  await trivia.judgeDue(id)
  await trivia.open(sam, id)
  await openNow(qs[1]!.id)
  await trivia.answer(bayo, id, qs[1]!.id, { text: 'AOT' }) // not accepted (yet)
  assert.equal(await refusal(() => trivia.answer(bayo, id, qs[1]!.id, { text: 'Attack on Titan' })), 'answered', 'a typed answer is final')
  await trivia.answer(ada, id, qs[1]!.id, { text: 'Atack on Titan' }) // one typo
  await closeNow(qs[1]!.id)
  await trivia.judgeDue(id)
  const [round] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(round!.status, 'reviewing', 'the last question has closed')

  const host = await trivia.hostView(sam, id)
  assert.deepEqual(host.questions[1]!.wrong.map((w) => [w.normalised, w.count]), [['aot', 1]])
  assert.equal(await refusal(() => trivia.accept(ada, id, qs[1]!.id, 'aot')), 'not_host')
  // Bayo answered first: accepting his spelling makes him first.
  await trivia.accept(sam, id, qs[1]!.id, 'aot')
  const after = await db.select().from(triviaAnswers).where(eq(triviaAnswers.questionId, qs[1]!.id))
  assert.deepEqual(after.find((a) => a.memberId === bayo)!.place, 1)
  assert.deepEqual(after.find((a) => a.memberId === ada)!.place, 2)
  const [q] = await db.select().from(triviaQuestions).where(eq(triviaQuestions.id, qs[1]!.id))
  assert.ok(q!.accepted!.includes('AOT'))

  await trivia.void(sam, id, qs[1]!.id)
  const voided = await db.select().from(triviaAnswers).where(eq(triviaAnswers.questionId, qs[1]!.id))
  assert.ok(voided.every((a) => a.points === 0 && a.place === null))
})

test('publishing: places, season points, Game Score XP, and the results by name, a minor as "a member"', async () => {
  const { id, qs } = await running()
  await trivia.answer(chi, id, qs[0]!.id, { choice: 0 }) // first: chi is under 18
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 })
  await closeNow(qs[0]!.id)
  await trivia.judgeDue(id)
  // The first answer makes the thread a story, which bayo, watching, follows.
  const [{ threadPostId }] = (await db.select({ threadPostId: triviaRounds.threadPostId }).from(triviaRounds).where(eq(triviaRounds.id, id))) as [{ threadPostId: string }]
  assert.equal(await postsService.followStory(bayo, threadPostId), true)
  await trivia.open(sam, id)
  await openNow(qs[1]!.id)
  await trivia.answer(ada, id, qs[1]!.id, { text: 'Shingeki no Kyojin' })
  await closeNow(qs[1]!.id)
  await trivia.judgeDue(id)

  await trivia.publishResults(sam, id)
  await trivia.publishResults(sam, id) // twice changes nothing
  const results = await db.select().from(triviaResults).where(eq(triviaResults.roundId, id))
  const of = (m: string) => results.find((r) => r.memberId === m)!
  assert.deepEqual([of(ada).place, of(ada).points, of(ada).rightCount, of(ada).firsts], [1, 28, 2, 1])
  assert.deepEqual([of(chi).place, of(chi).points], [2, 15])

  const [season] = await db.select().from(seasonScores).where(and(eq(seasonScores.memberId, ada), eq(seasonScores.game, 'trivia')))
  assert.equal(season!.points, 28)
  // XP: 2 for playing, +1 a right answer, +2 a first: 2 + 2 + 2 = 6.
  const [xp] = await db.select().from(xpTotals).where(and(eq(xpTotals.memberId, ada), eq(xpTotals.period, 'all')))
  assert.equal(xp!.xp, 6)

  const [round] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(round!.status, 'published')
  const [result] = await db.select().from(posts).where(eq(posts.id, round!.resultPostId!))
  assert.match(result!.text, /1\. Ada · 28 points/)
  assert.match(result!.text, /2\. a member · 15 points/)
  assert.doesNotMatch(result!.text, /Chidi/)
  // An update to the thread's story, not a reply: feeds show it in the announcement's place.
  assert.deepEqual([result!.storyId, result!.replyParentId, result!.superseded], [round!.threadPostId, null, false])
  const [thread] = await db.select().from(posts).where(eq(posts.id, round!.threadPostId!))
  assert.equal(thread!.superseded, true)
  // The story, in order: each question's answer, then the results.
  const story = await db.select().from(posts).where(eq(posts.storyId, thread!.id)).orderBy(posts.createdAt)
  const [q1, q2] = await questionsOf(id)
  assert.deepEqual(story.map((p) => p.id), [q1!.revealPostId, q2!.revealPostId, result!.id])
  // Game Night's feed shows the round once, as its results, with the announcement above them.
  const feed = await postsService.inCommunity(bayo, thread!.communityId!, 20)
  assert.deepEqual(
    feed.posts.map((p) => [p.id, p.story?.number, p.story?.id]),
    [[result!.id, 3, thread!.id]],
  )
  // bayo followed after the first answer, so is told of the second and of the results.
  const told = await db.select().from(notifications).where(and(eq(notifications.recipientId, bayo), eq(notifications.kind, 'story_update')))
  assert.deepEqual(told.map((n) => n.postId).sort(), [q2!.revealPostId, result!.id].sort())
  // Who was first goes under the results, where they are talked about.
  const firsts = await db.select().from(posts).where(and(eq(posts.replyParentId, result!.id), sql`text like 'First right answer%'`))
  assert.match(firsts[0]!.text, /Q1: a member/)
  assert.match(firsts[0]!.text, /Q2: Ada/)
  const view = (await trivia.view(bayo, id))!
  assert.equal(view.final, true)
  assert.deepEqual(view.standings.map((s) => [s.handle, s.rank]), [['ada', 1], ['chi', 2]])
})

test('a round whose thread was taken down still gets its results, as a post of their own', async () => {
  const { id, qs } = await running()
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 })
  await closeNow(qs[0]!.id)
  await trivia.judgeDue(id)
  await trivia.end(sam, id)
  const [before] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  const [thread] = await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, before!.threadPostId!)).returning()
  await trivia.publishResults(sam, id)
  const [round] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  const [result] = await db.select().from(posts).where(eq(posts.id, round!.resultPostId!))
  assert.match(result!.text, /1\. Ada · 15 points/)
  // In Game Night, where the thread was.
  assert.deepEqual([result!.storyId, result!.replyParentId, result!.communityId], [null, null, thread!.communityId])
  const [firsts] = await db.select().from(posts).where(eq(posts.replyParentId, result!.id))
  assert.match(firsts!.text, /Q1: Ada/)
})

test('the background work: questions nobody watches are judged, an idle round ends, results publish themselves', async () => {
  const { id, qs } = await running()
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 })
  await closeNow(qs[0]!.id)
  await db.update(triviaRounds).set({ activeAt: new Date(Date.now() - 11 * 60_000) }).where(eq(triviaRounds.id, id))
  await trivia.tick()
  const [ended] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(ended!.status, 'reviewing', 'the host went quiet: the unasked question is dropped')
  const [unasked] = await db.select().from(triviaQuestions).where(eq(triviaQuestions.id, qs[1]!.id))
  assert.ok(unasked!.voidedAt)

  await db.update(triviaRounds).set({ endedAt: new Date(Date.now() - REVIEW_MS - 1000) }).where(eq(triviaRounds.id, id))
  await trivia.tick()
  const [done] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, id))
  assert.equal(done!.status, 'published')

  triviaOn = false
  const other = await running()
  await closeNow(other.qs[0]!.id)
  await trivia.tick()
  const [still] = await db.select().from(triviaQuestions).where(eq(triviaQuestions.id, other.qs[0]!.id))
  assert.equal(still!.judgedAt, null, 'nothing runs while Trivia is off for everyone')
})

test('a member blocked by the host, or who blocked the host, does not see the round', async () => {
  const { id } = await running()
  await db.insert(blocks).values({ blockerId: sam, blockedId: bayo })
  assert.equal(await trivia.view(bayo, id), null)
  assert.equal(await refusal(() => trivia.answer(bayo, id, randomUUID(), { choice: 0 })), 'not_found')
  assert.deepEqual((await trivia.list(bayo)).live, [])
  assert.ok(await trivia.view(ada, id))
})

test('ending early drops the questions not asked; cancelling scores nothing', async () => {
  const { id, qs } = await running()
  await trivia.answer(ada, id, qs[0]!.id, { choice: 0 })
  await trivia.end(sam, id)
  const after = await questionsOf(id)
  assert.ok(after[0]!.judgedAt && !after[0]!.voidedAt, 'the open one is judged')
  assert.ok(after[1]!.voidedAt, 'the next is dropped')
  const second = await running()
  await trivia.cancel(sam, second.id)
  await trivia.publishResults(sam, second.id)
  const [cancelled] = await db.select().from(triviaRounds).where(eq(triviaRounds.id, second.id))
  assert.equal(cancelled!.status, 'cancelled', 'a cancelled round never publishes')
  assert.deepEqual(await db.select().from(triviaResults).where(eq(triviaResults.roundId, second.id)), [])
})
