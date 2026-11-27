import { communities, type Db, media, members, triviaQuestions, triviaRounds } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Env } from '../../env.js'
import { FeatureFlags } from '../../flags/feature-flags.js'
import { ageStatusOf } from '../../governance/governance.service.js'
import { isAdultFor } from '../../governance/age.js'
import { isMinor } from '../../governance/minors.js'
import { ALT_MAX, avatarPath, postImagePath } from '../../media/media.service.js'
import { blockedEitherWay, PostsService, StoryNotFoundError } from '../../posts/posts.service.js'
import { DB, ENV } from '../../tokens.js'
import { ARBITER_ID, GAME_NIGHT_SLUG } from '../chess/arena-ids.js'
import { recordEvents } from '../core/scoring.js'
import { ensureSeason } from '../core/seasons.js'
import { choiceOrder, matches, normalise, placesOf, pointsFor, roundPlaces } from './judging.js'

// Trivia (docs/games/GAMES.md, docs/adr/0028 phase 7): a host's round of questions,
// one open at a time. Answers stay on the server until their question closes, and
// who answered first is the database's own clock. Free to play: points buy nothing.

/** A question's text appears this long after the host opens it, so every screen counts down together. */
export const COUNTDOWN_MS = 3_000
/** With the next question opening by itself, the answer shows this long first. */
export const REVEAL_MS = 8_000
/** After the last question, the host has this long to accept spellings before the results publish themselves. */
export const REVIEW_MS = 15 * 60_000
/** A live round whose host has done nothing for this long ends by itself. */
export const IDLE_MS = 10 * 60_000
export const MAX_QUESTIONS = 30
/** A round may be set to start this long ago, so a host can run one now; never earlier. */
export const START_GRACE_MS = 5 * 60_000
export const PROMPT_MAX = 300
export const CHOICE_MAX = 80
export const ANSWER_MAX = 80
export const ACCEPTED_MAX = 10
export const TITLE_MAX = 80
const STANDINGS_SIZE = 10
const RESULT_TOP = 10

export type TriviaErrorCode = 'not_found' | 'not_host' | 'invalid' | 'closed' | 'answered' | 'not_editable' | 'none_left' | 'busy'

export class TriviaError extends Error {
  constructor(
    readonly code: TriviaErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type QuestionInput = {
  kind: 'choice' | 'typed'
  prompt: string
  choices?: string[]
  correctChoice?: number
  accepted?: string[]
  explanation?: string | null
  /** An uploaded post image (ready, not on a post) and its description for screen readers. */
  image?: { id: string; alt: string } | null
}

/** A question's picture as pages show it, like a post's: its files are `src` plus `/640.webp` or `/1600.webp`. */
export type QuestionPicture = { src: string; alt: string; width: number | null; height: number | null; animated: boolean }

export type RoundInput = {
  title: string
  /** A community's slug: The Arbiter posts there. Null for Game Night. */
  community?: string | null
  startsAt: Date
  secondsPerQuestion: number
  autoAdvance: boolean
  questions: QuestionInput[]
}

export type Person = { handle: string; displayName: string | null; avatar: string | null }

export type RoundCard = {
  id: string
  title: string
  status: string
  startsAt: Date
  questions: number
  secondsPerQuestion: number
  host: Person
  community: { slug: string; name: string } | null
  /** Players so far (answered at least once). */
  players: number
  /** The viewer's place, once published. */
  yourPlace: number | null
}

export type Standing = Person & { rank: number; points: number; you: boolean }

export type CurrentQuestion = {
  id: string
  position: number
  opensAt: Date
  closesAt: Date
  kind: 'choice' | 'typed'
  /** Only once it has opened. */
  prompt: string | null
  /** In the viewer's own order, each with its id; only once it has opened. */
  choices: { id: number; text: string }[] | null
  /** Only once it has opened, like the question itself. */
  image: QuestionPicture | null
  yourAnswer: { choice: number | null; text: string | null; ms: number } | null
}

export type Reveal = {
  id: string
  position: number
  prompt: string
  kind: 'choice' | 'typed'
  voided: boolean
  /** The right choice's text, or the first accepted answer. */
  answer: string
  alsoAccepted: string[]
  explanation: string | null
  choices: { id: number; text: string; count: number; right: boolean }[] | null
  image: QuestionPicture | null
  answered: number
  rightCount: number
  firsts: (Person & { ms: number })[]
  you: { choice: number | null; text: string | null; correct: boolean; points: number; place: number | null; ms: number } | null
}

export type RoundView = {
  id: string
  title: string
  status: string
  startsAt: Date
  secondsPerQuestion: number
  questions: number
  host: Person
  community: { slug: string; name: string } | null
  threadPostId: string | null
  resultPostId: string | null
  version: number
  /** The database's clock now, so a screen counts down from the server's time, not the phone's. */
  serverTime: Date
  /** `host`: the viewer hosts it. `canAnswer`: false for anyone who may see the answers (the host, and other hosts). */
  you: { host: boolean; canAnswer: boolean; points: number }
  current: CurrentQuestion | null
  last: Reveal | null
  standings: Standing[]
  yourStanding: Standing | null
  /** The standings are final: the results are published. */
  final: boolean
}

export type HostQuestion = {
  id: string
  position: number
  kind: 'choice' | 'typed'
  prompt: string
  choices: string[] | null
  correctChoice: number | null
  accepted: string[] | null
  explanation: string | null
  /** With the uploaded image's id, so the form can send it back. */
  image: (QuestionPicture & { id: string }) | null
  opensAt: Date | null
  closesAt: Date | null
  judged: boolean
  voided: boolean
  answered: number
  rightCount: number
  /** For a judged typed question: the wrong answers, grouped as the matcher reads them, most common first. */
  wrong: { normalised: string; sample: string; count: number; fast: number }[]
}

export type HostView = {
  id: string
  title: string
  status: string
  startsAt: Date
  secondsPerQuestion: number
  autoAdvance: boolean
  community: { slug: string; name: string } | null
  threadPostId: string | null
  version: number
  serverTime: Date
  endedAt: Date | null
  /** When the results publish themselves, if the host does not. */
  publishesAt: Date | null
  questions: HostQuestion[]
}

type RoundRow = typeof triviaRounds.$inferSelect
type QuestionRow = typeof triviaQuestions.$inferSelect
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Queries = Db | Tx

/** Tells every API process's long-polls that a round changed; sent when the transaction commits. */
export const notifyRound = (q: Pick<Db, 'execute'>, roundId: string) => q.execute(sql`select pg_notify('trivia_round', ${roundId})`)

/** A name for public posts: a member under 18 is "a member" (ADR 0020), as is a deleted account. */
const publicName = (r: { display_name: string | null; handle: string; minor: boolean; active: boolean }) =>
  r.minor || !r.active ? 'a member' : (r.display_name?.trim() || r.handle).slice(0, 40)

/** "2.41 s" */
export const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`

const lagosTime = (at: Date) =>
  // "at 00:26", not "at 0:26", after midnight.
  new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)

@Injectable()
export class TriviaService {
  private readonly logger = new Logger('Trivia')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_PUBLIC_URL'>,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'onForAnyone'>,
    @Inject(PostsService) private readonly posts: Pick<PostsService, 'create'>,
  ) {}

  private link(roundId: string) {
    return `${this.env.WEB_PUBLIC_URL}/games/trivia/rounds/${roundId}`
  }

  // --- Who hosts ----------------------------------------------------------------

  /** Site moderators who are adults by their stated age host rounds (owner, 15 November 2026). */
  async mayHost(memberId: string): Promise<boolean> {
    const [m] = await this.db.select({ role: members.role, active: members.active }).from(members).where(eq(members.id, memberId))
    if (m?.role !== 'moderator' || !m.active) return false
    return isAdultFor(await ageStatusOf(this.db, memberId), 'trivia_host')
  }

  private async requireHost(memberId: string): Promise<void> {
    if (!(await this.mayHost(memberId))) throw new TriviaError('not_host', 'Only site moderators host trivia rounds for now.')
  }

  /** The round, which `memberId` hosts (or, as a site moderator, may manage). */
  private async ownRound(q: Queries, memberId: string, roundId: string, lock = false): Promise<RoundRow> {
    const query = q.select().from(triviaRounds).where(eq(triviaRounds.id, roundId))
    const [round] = lock ? await query.for('update') : await query
    if (!round) throw new TriviaError('not_found', 'There is no such round.')
    if (round.hostId !== memberId && !(await this.mayHost(memberId))) throw new TriviaError('not_host', 'This is not your round.')
    return round
  }

  // --- Making a round ---------------------------------------------------------------

  private checked(input: RoundInput): RoundInput {
    const title = input.title.trim()
    if (title.length < 3 || title.length > TITLE_MAX) throw new TriviaError('invalid', `Give the round a title of 3 to ${TITLE_MAX} characters.`)
    if (!Number.isInteger(input.secondsPerQuestion) || input.secondsPerQuestion < 10 || input.secondsPerQuestion > 60) {
      throw new TriviaError('invalid', 'Each question can be open for 10 to 60 seconds.')
    }
    if (!input.questions.length || input.questions.length > MAX_QUESTIONS) throw new TriviaError('invalid', `A round has 1 to ${MAX_QUESTIONS} questions.`)
    const questions = input.questions.map((q, i): QuestionInput => {
      const n = i + 1
      const prompt = q.prompt.trim()
      if (!prompt || prompt.length > PROMPT_MAX) throw new TriviaError('invalid', `Question ${n} needs its question, up to ${PROMPT_MAX} characters.`)
      const explanation = q.explanation?.trim() || null
      if (explanation && explanation.length > PROMPT_MAX) throw new TriviaError('invalid', `Question ${n}'s note is longer than ${PROMPT_MAX} characters.`)
      const image = q.image ? { id: q.image.id, alt: q.image.alt.trim() } : null
      if (image && (!image.alt || image.alt.length > ALT_MAX)) {
        throw new TriviaError('invalid', `Describe question ${n}'s picture for people who cannot see it, in up to ${ALT_MAX} characters.`)
      }
      if (q.kind === 'choice') {
        const choices = (q.choices ?? []).map((c) => c.trim())
        if (choices.length < 2 || choices.length > 4 || choices.some((c) => !c || c.length > CHOICE_MAX)) {
          throw new TriviaError('invalid', `Question ${n} needs 2 to 4 choices, each up to ${CHOICE_MAX} characters.`)
        }
        if (new Set(choices.map((c) => c.toLowerCase())).size !== choices.length) throw new TriviaError('invalid', `Question ${n} has the same choice twice.`)
        if (!Number.isInteger(q.correctChoice) || q.correctChoice! < 0 || q.correctChoice! >= choices.length) {
          throw new TriviaError('invalid', `Question ${n} needs one right choice.`)
        }
        return { kind: 'choice', prompt, choices, correctChoice: q.correctChoice, explanation, image }
      }
      const accepted = [...new Set((q.accepted ?? []).map((a) => a.trim()).filter(Boolean))]
      if (!accepted.length || accepted.length > ACCEPTED_MAX || accepted.some((a) => a.length > ANSWER_MAX || !normalise(a))) {
        throw new TriviaError('invalid', `Question ${n} needs 1 to ${ACCEPTED_MAX} accepted answers, each up to ${ANSWER_MAX} characters.`)
      }
      return { kind: 'typed', prompt, accepted, explanation, image }
    })
    const pictures = questions.flatMap((q) => (q.image ? [q.image.id] : []))
    if (new Set(pictures).size !== pictures.length) throw new TriviaError('invalid', 'Each picture can be on one question only.')
    return { ...input, title, questions }
  }

  private async communityId(slug: string | null | undefined): Promise<string | null> {
    if (!slug) return null
    const [c] = await this.db.select({ id: communities.id }).from(communities).where(and(eq(communities.slug, slug), eq(communities.active, true)))
    if (!c) throw new TriviaError('invalid', 'There is no such community.')
    return c.id
  }

  private questionRows(roundId: string, questions: QuestionInput[]) {
    return questions.map((q, i) => ({
      roundId,
      position: i + 1,
      kind: q.kind,
      prompt: q.prompt,
      choices: q.kind === 'choice' ? q.choices! : null,
      correctChoice: q.kind === 'choice' ? q.correctChoice! : null,
      accepted: q.kind === 'typed' ? q.accepted! : null,
      explanation: q.explanation ?? null,
      imageId: q.image?.id ?? null,
      imageAlt: q.image?.alt ?? '',
    }))
  }

  /**
   * Every picture is a ready image that is on no post: one the editor uploaded and
   * no question uses yet, or one already on this round (another host may be editing
   * it). The pictures' files are public once processed, but nobody is given their
   * address until the question opens.
   */
  private async checkPictures(q: Tx, memberId: string, roundId: string | null, questions: QuestionInput[]): Promise<void> {
    const ids = questions.flatMap((x) => (x.image ? [x.image.id] : []))
    if (!ids.length) return
    const { rows } = await q.execute<{ id: string }>(sql`
      select m.id from media m
      where m.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        and m.kind = 'post_image' and m.status = 'ready' and m.post_id is null and not m.served_privately
        and (${roundId ? sql`exists(select 1 from games.trivia_questions t where t.image_id = m.id and t.round_id = ${roundId})` : sql`false`}
          or (m.owner_id = ${memberId} and not exists(select 1 from games.trivia_questions t where t.image_id = m.id)))`)
    const usable = new Set(rows.map((r) => r.id))
    questions.forEach((x, i) => {
      if (x.image && !usable.has(x.image.id)) {
        throw new TriviaError('invalid', `Question ${i + 1}'s picture is not ready to use yet, or is used elsewhere. Wait a moment, or add it again.`)
      }
    })
  }

  /** The pictures of these questions that can be shown, by question id. */
  private async pictures(questions: QuestionRow[]): Promise<Map<string, QuestionPicture & { id: string }>> {
    const ids = questions.flatMap((q) => (q.imageId ? [q.imageId] : []))
    if (!ids.length) return new Map()
    const rows = await this.db
      .select({ id: media.id, width: media.width, height: media.height, animated: media.animated })
      .from(media)
      .where(and(inArray(media.id, ids), eq(media.status, 'ready'), eq(media.servedPrivately, false)))
    const files = new Map(rows.map((r) => [r.id, r]))
    return new Map(
      questions.flatMap((q) => {
        const m = q.imageId ? files.get(q.imageId) : undefined
        return m ? [[q.id, { id: m.id, src: postImagePath(m.id), alt: q.imageAlt, width: m.width, height: m.height, animated: m.animated }] as const] : []
      }),
    )
  }

  /** A new round, as a draft nobody else sees. Returns its id. */
  async create(hostId: string, raw: RoundInput): Promise<string> {
    await this.requireHost(hostId)
    const input = this.checked(raw)
    await this.startNotPast(input.startsAt)
    const communityId = await this.communityId(input.community)
    return this.db.transaction(async (tx) => {
      await this.checkPictures(tx, hostId, null, input.questions)
      const [round] = await tx
        .insert(triviaRounds)
        .values({ hostId, communityId, title: input.title, startsAt: input.startsAt, secondsPerQuestion: input.secondsPerQuestion, autoAdvance: input.autoAdvance })
        .returning({ id: triviaRounds.id })
      await tx.insert(triviaQuestions).values(this.questionRows(round!.id, input.questions))
      return round!.id
    })
  }

  /**
   * Changes a round until its first question opens. Once it is on the schedule its
   * thread stays in its community (posts are never edited or moved), open pages
   * see the change at once, and The Arbiter says what changed: a new start time as
   * an update to its thread's story (docs/adr/0024), which brings the round back
   * into feeds and tells the story's followers; anything else as a reply.
   */
  async update(memberId: string, roundId: string, raw: RoundInput): Promise<void> {
    const input = this.checked(raw)
    const communityId = await this.communityId(input.community)
    const told = await this.db.transaction(async (tx) => {
      const round = await this.ownRound(tx, memberId, roundId, true)
      const [count] = await tx
        .execute<{ n: number; opened: number }>(sql`select count(*)::int as n, count(opens_at)::int as opened from games.trivia_questions where round_id = ${roundId}`)
        .then((r) => r.rows)
      if (!['draft', 'scheduled'].includes(round.status) || (count?.opened ?? 0) > 0) throw new TriviaError('not_editable', 'A round cannot be changed once a question has opened.')
      const scheduled = round.status === 'scheduled'
      if (scheduled && communityId !== round.communityId) {
        throw new TriviaError('not_editable', 'The Arbiter has already posted this round in its community, so it stays there. To move it, call it off and make it again.')
      }
      const moved = input.startsAt.getTime() !== round.startsAt.getTime()
      if (moved) await this.startNotPast(input.startsAt, tx)
      await this.checkPictures(tx, memberId, roundId, input.questions)
      await tx
        .update(triviaRounds)
        .set({
          title: input.title,
          communityId,
          startsAt: input.startsAt,
          secondsPerQuestion: input.secondsPerQuestion,
          autoAdvance: input.autoAdvance,
          activeAt: new Date(),
          version: sql`${triviaRounds.version} + 1`,
        })
        .where(eq(triviaRounds.id, roundId))
      await tx.delete(triviaQuestions).where(eq(triviaQuestions.roundId, roundId))
      await tx.insert(triviaQuestions).values(this.questionRows(roundId, input.questions))
      await notifyRound(tx, roundId)
      const changed = moved || round.title !== input.title || round.secondsPerQuestion !== input.secondsPerQuestion || count?.n !== input.questions.length
      return scheduled && changed && round.threadPostId ? { thread: round.threadPostId, moved } : null
    })
    if (!told) return
    // The announcement cannot change, so its thread hears what is true now. People
    // planning to play need a new time, so that is an update; a new title or
    // question count is only a reply.
    const n = input.questions.length
    const text = `Update: ${input.title} is now on ${lagosTime(input.startsAt)} Lagos time. ${n} ${n === 1 ? 'question' : 'questions'}, ${input.secondsPerQuestion} seconds each.`
    await this.posts
      .create(ARBITER_ID, text, told.moved ? { storyOf: told.thread } : { replyTo: told.thread })
      .catch((err) => this.logger.warn(`telling round ${roundId}'s thread of a change: ${(err as Error).message}`))
  }

  /** Refuses a start time that has already passed (by more than a few minutes). */
  private async startNotPast(at: Date, q: Pick<Db, 'execute'> = this.db): Promise<void> {
    if (at.getTime() < (await this.dbNow(q)).getTime() - START_GRACE_MS) {
      throw new TriviaError('invalid', 'That start time has already passed. Pick a later one.')
    }
  }

  /** Puts a draft on the schedule: The Arbiter posts its thread, where members will talk about it. */
  async publish(memberId: string, roundId: string): Promise<void> {
    const round = await this.ownRound(this.db, memberId, roundId)
    if (round.status !== 'draft') throw new TriviaError('not_editable', 'This round is already on the schedule.')
    // The Arbiter would announce a time that has gone.
    if (round.startsAt.getTime() < (await this.dbNow()).getTime() - START_GRACE_MS) {
      throw new TriviaError('invalid', 'Its start time has already passed. Edit the round and pick a later one first.')
    }
    const [{ n }] = (await this.db.execute<{ n: number }>(sql`select count(*)::int as n from games.trivia_questions where round_id = ${roundId}`)).rows as [{ n: number }]
    const slug = await this.postingSlug(round)
    const text = [
      // Members abroad read it too, so the time says whose clock it is.
      `${round.title}: ${lagosTime(round.startsAt)} Lagos time.`,
      `${n} ${n === 1 ? 'question' : 'questions'}, ${round.secondsPerQuestion} seconds each. Play here: ${this.link(round.id)}`,
      'Answers stay hidden until each question closes. The first right answer scores most.',
      'As each question closes, its answer is added to this post. Talk about a question in the replies to its answer.',
    ].join('\n\n')
    await this.posts.create(ARBITER_ID, text, {
      communitySlug: slug,
      anyMember: true,
      alongside: async (tx, postId) => {
        await tx.update(triviaRounds).set({ status: 'scheduled', threadPostId: postId, version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, roundId))
      },
    })
  }

  private async postingSlug(round: Pick<RoundRow, 'communityId'>): Promise<string> {
    if (!round.communityId) return GAME_NIGHT_SLUG
    const [c] = await this.db.select({ slug: communities.slug }).from(communities).where(and(eq(communities.id, round.communityId), eq(communities.active, true)))
    return c?.slug ?? GAME_NIGHT_SLUG
  }

  /** Calls a round off: nobody scores anything from it. */
  async cancel(memberId: string, roundId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const round = await this.ownRound(tx, memberId, roundId, true)
      if (round.status === 'published' || round.status === 'cancelled') throw new TriviaError('not_editable', 'This round is over.')
      await tx.update(triviaRounds).set({ status: 'cancelled', endedAt: new Date(), version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, roundId))
      await notifyRound(tx, roundId)
    })
  }

  // --- Running a round --------------------------------------------------------------

  /** The database's clock now: the one clock every API process agrees on. */
  async dbNow(q: Pick<Db, 'execute'> = this.db): Promise<Date> {
    const { rows } = await q.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`)
    return new Date(rows[0]!.now)
  }

  /**
   * Opens the next question: its text appears to everyone three seconds from now,
   * by the database's clock, and it closes after the round's seconds.
   */
  async open(memberId: string, roundId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const round = await this.ownRound(tx, memberId, roundId, true)
      if (round.status !== 'scheduled' && round.status !== 'live') throw new TriviaError('not_editable', 'This round is not running.')
      const [pending] = await tx.execute<{ id: string }>(sql`
        select id from games.trivia_questions where round_id = ${roundId} and opens_at is not null and judged_at is null and voided_at is null limit 1`).then((r) => r.rows)
      if (pending) throw new TriviaError('busy', 'A question is still open.')
      const [next] = await tx
        .select()
        .from(triviaQuestions)
        .where(and(eq(triviaQuestions.roundId, roundId), sql`opens_at is null and voided_at is null`))
        .orderBy(asc(triviaQuestions.position))
        .limit(1)
      if (!next) throw new TriviaError('none_left', 'Every question has been asked.')
      await this.schedule(tx, next.id, COUNTDOWN_MS, round.secondsPerQuestion)
      await tx.update(triviaRounds).set({ status: 'live', activeAt: new Date(), version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, roundId))
      await notifyRound(tx, roundId)
    })
  }

  /** Sets a question to open `inMs` from now, by the database's clock, for `seconds`. */
  private async schedule(q: Pick<Db, 'execute'>, questionId: string, inMs: number, seconds: number) {
    await q.execute(sql`
      update games.trivia_questions
      set opens_at = clock_timestamp() + make_interval(secs => ${inMs / 1000}),
          closes_at = clock_timestamp() + make_interval(secs => ${inMs / 1000 + seconds})
      where id = ${questionId}`)
  }

  /**
   * An answer: one per member per question, and final. It counts only if the
   * database's clock, as it writes the answer, is between the question's opening
   * and closing; that time, to the microsecond, is what decides who was first.
   */
  async answer(memberId: string, roundId: string, questionId: string, given: { choice?: number; text?: string }): Promise<{ ms: number }> {
    const [round] = await this.db.select().from(triviaRounds).where(eq(triviaRounds.id, roundId))
    if (!round || !(await this.visible(memberId, round))) throw new TriviaError('not_found', 'There is no such round.')
    // Whoever can open the host's view sees the answers: the host, and site moderators who may host.
    if (round.hostId === memberId) throw new TriviaError('invalid', 'You are hosting this round, so you cannot answer.')
    if (await this.mayHost(memberId)) throw new TriviaError('invalid', 'Trivia hosts can see every round’s answers, so they watch without answering.')
    const [question] = await this.db.select().from(triviaQuestions).where(and(eq(triviaQuestions.id, questionId), eq(triviaQuestions.roundId, roundId)))
    if (!question) throw new TriviaError('not_found', 'There is no such question.')
    let choice: number | null = null
    let text: string | null = null
    let normalised: string | null = null
    if (question.kind === 'choice') {
      if (!Number.isInteger(given.choice) || given.choice! < 0 || given.choice! >= (question.choices?.length ?? 0)) throw new TriviaError('invalid', 'Choose one of the answers.')
      choice = given.choice!
    } else {
      text = (given.text ?? '').trim().slice(0, ANSWER_MAX)
      normalised = normalise(text)
      if (!normalised) throw new TriviaError('invalid', 'Type an answer.')
    }
    // A choice can be changed while the question is open, and the change is the answer's time:
    // a new `answered_at` and a new `seq`, so a late switch to the right choice is not first.
    // A typed answer is final. The question row is held (`for share`) while the answer is
    // written, so judging (`for update skip locked`) waits for it rather than reading the
    // choice it replaces.
    const { rows } = await this.db.execute<{ ms: number }>(sql`
      insert into games.trivia_answers (question_id, member_id, round_id, choice, text, normalised)
      select q.id, ${memberId}, ${roundId}, ${choice}::smallint, ${text}, ${normalised}
      from games.trivia_questions q
      where q.id = ${questionId} and q.voided_at is null and q.judged_at is null
        and q.opens_at <= clock_timestamp() and q.closes_at > clock_timestamp()
      for share
      on conflict (question_id, member_id) do update
        set choice = excluded.choice, answered_at = clock_timestamp(), seq = default
        where games.trivia_answers.choice is not null and excluded.choice is not null
          and games.trivia_answers.choice <> excluded.choice
      returning (extract(epoch from (answered_at - (select opens_at from games.trivia_questions where id = ${questionId}))) * 1000)::int as ms`)
    if (rows[0]) return { ms: Number(rows[0].ms) }
    const [mine] = (
      await this.db.execute<{ choice: number | null; ms: number; open: boolean }>(sql`
        select a.choice, (extract(epoch from (a.answered_at - q.opens_at)) * 1000)::int as ms,
          (q.voided_at is null and q.judged_at is null and q.opens_at <= clock_timestamp() and q.closes_at > clock_timestamp()) as open
        from games.trivia_answers a join games.trivia_questions q on q.id = a.question_id
        where a.question_id = ${questionId} and a.member_id = ${memberId}`)
    ).rows
    // The same choice again while it is open changes nothing, and keeps its time.
    if (mine && mine.open && question.kind === 'choice' && mine.choice !== null && Number(mine.choice) === choice) return { ms: Number(mine.ms) }
    if (mine && question.kind !== 'choice') throw new TriviaError('answered', 'You have answered this one already.')
    throw new TriviaError('closed', 'Time is up for this question.')
  }

  /** Judges every question whose time is up and that nobody has judged yet. Safe in any number of processes at once. */
  async judgeDue(roundId?: string): Promise<number> {
    let judged = 0
    for (;;) {
      const done = await this.db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ id: string }>(sql`
          select id from games.trivia_questions
          where judged_at is null and voided_at is null and closes_at <= clock_timestamp()
            ${roundId ? sql`and round_id = ${roundId}` : sql``}
          order by closes_at limit 1 for update skip locked`)
        if (!rows[0]) return null
        return this.judge(tx, rows[0].id)
      })
      if (!done) return judged
      judged++
      await this.postReveal(done).catch((err) => this.logger.warn(`posting the answer to question ${done}: ${(err as Error).message}`))
    }
  }

  /** Marks every answer right or wrong, works out the first three and the points, and moves the round on. */
  private async judge(tx: Tx, questionId: string): Promise<string> {
    const [q] = await tx.select().from(triviaQuestions).where(eq(triviaQuestions.id, questionId))
    await this.score(tx, q!)
    await tx.update(triviaQuestions).set({ judgedAt: await this.dbNow(tx) }).where(eq(triviaQuestions.id, questionId))
    const [round] = await tx.select().from(triviaRounds).where(eq(triviaRounds.id, q!.roundId)).for('update')
    const [next] = await tx
      .select({ id: triviaQuestions.id })
      .from(triviaQuestions)
      .where(and(eq(triviaQuestions.roundId, q!.roundId), sql`opens_at is null and voided_at is null`))
      .orderBy(asc(triviaQuestions.position))
      .limit(1)
    if (!next) {
      await tx.update(triviaRounds).set({ status: 'reviewing', endedAt: await this.dbNow(tx), version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, q!.roundId))
    } else {
      if (round!.autoAdvance && round!.status === 'live') await this.schedule(tx, next.id, REVEAL_MS + COUNTDOWN_MS, round!.secondsPerQuestion)
      await tx.update(triviaRounds).set({ version: sql`${triviaRounds.version} + 1`, ...(round!.autoAdvance ? { activeAt: new Date() } : {}) }).where(eq(triviaRounds.id, q!.roundId))
    }
    await notifyRound(tx, q!.roundId)
    return questionId
  }

  /** (Re)works out a judged or closing question's right answers, places, points and firsts from what is accepted now. */
  private async score(tx: Tx, q: QuestionRow): Promise<void> {
    const { rows } = await tx.execute<{ member_id: string; choice: number | null; normalised: string | null; accepted_by: string | null; answered_at: Date | string; seq: number }>(sql`
      select member_id, choice, normalised, accepted_by, answered_at, seq from games.trivia_answers where question_id = ${q.id}`)
    const judged = rows.map((a) => ({
      memberId: a.member_id,
      correct: q.voidedAt ? false : q.kind === 'choice' ? a.choice === q.correctChoice : Boolean(a.accepted_by) || matches(a.normalised ?? '', q.accepted ?? []),
      answeredAt: new Date(a.answered_at),
      seq: Number(a.seq),
    }))
    const places = placesOf(judged)
    for (const a of judged) {
      const place = places.get(a.memberId) ?? null
      await tx.execute(sql`
        update games.trivia_answers set correct = ${a.correct}, place = ${place}::int, points = ${pointsFor(a.correct, place)}::int
        where question_id = ${q.id} and member_id = ${a.memberId}`)
    }
    const firsts = [...places]
      .sort((x, y) => x[1] - y[1])
      .slice(0, 3)
      .map(([memberId]) => ({ memberId, ms: judged.find((a) => a.memberId === memberId)!.answeredAt.getTime() - (q.opensAt?.getTime() ?? 0) }))
    await tx
      .update(triviaQuestions)
      .set({ firsts, answered: judged.length, rightCount: places.size })
      .where(eq(triviaQuestions.id, q.id))
  }

  /**
   * The Arbiter's update to the thread's story once a question closes: the question, the
   * answer, and how many got it. Question by question, the story shows how the round went,
   * each question's talk goes under its own answer, and the story's followers are told of each.
   */
  private async postReveal(questionId: string): Promise<void> {
    const [q] = await this.db.select().from(triviaQuestions).where(eq(triviaQuestions.id, questionId))
    if (!q || q.revealPostId || q.voidedAt) return
    const [round] = await this.db.select().from(triviaRounds).where(eq(triviaRounds.id, q.roundId))
    if (!round?.threadPostId) return
    const [{ n }] = (await this.db.execute<{ n: number }>(sql`select count(*)::int as n from games.trivia_questions where round_id = ${round.id}`)).rows as [{ n: number }]
    const answer = q.kind === 'choice' ? q.choices![q.correctChoice!]! : q.accepted![0]!
    const also = q.kind === 'typed' ? q.accepted!.slice(1, 4) : []
    const text = [
      `Question ${q.position} of ${n}: ${q.prompt}`,
      `Answer: ${answer}${also.length ? ` (also accepted: ${also.join(', ')})` : ''}`,
      ...(q.explanation ? [q.explanation] : []),
      `${q.rightCount} of ${q.answered} got it right.`,
    ].join('\n\n')
    await this.posts.create(ARBITER_ID, text, {
      storyOf: round.threadPostId,
      alongside: async (tx, postId) => {
        await tx.update(triviaQuestions).set({ revealPostId: postId }).where(eq(triviaQuestions.id, q.id))
        // The picture goes on the update, so the talk under it shows what was asked. From
        // here on it is that post's: reported, removed or erased with it, like any post's.
        if (q.imageId) {
          await tx
            .update(media)
            .set({ postId, position: 0, alt: q.imageAlt })
            .where(and(eq(media.id, q.imageId), eq(media.kind, 'post_image'), eq(media.status, 'ready'), isNull(media.postId)))
        }
      },
    })
  }

  /** The host accepts a spelling the matcher did not: every answer that reads the same becomes right, and the points are worked out again. */
  async accept(memberId: string, roundId: string, questionId: string, normalisedGroup: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const round = await this.ownRound(tx, memberId, roundId, true)
      if (round.status === 'published' || round.status === 'cancelled') throw new TriviaError('not_editable', 'The results are already out.')
      const [q] = await tx.select().from(triviaQuestions).where(and(eq(triviaQuestions.id, questionId), eq(triviaQuestions.roundId, roundId))).for('update')
      if (!q || q.kind !== 'typed' || !q.judgedAt || q.voidedAt) throw new TriviaError('invalid', 'Only a judged typed question takes more answers.')
      const { rows } = await tx.execute<{ text: string }>(sql`
        update games.trivia_answers set accepted_by = ${memberId}
        where question_id = ${questionId} and normalised = ${normalisedGroup}
        returning text`)
      if (!rows.length) throw new TriviaError('not_found', 'Nobody gave that answer.')
      const spelling = rows[0]!.text
      const accepted = q.accepted!.some((a) => normalise(a) === normalisedGroup) ? q.accepted! : [...q.accepted!, spelling].slice(0, ACCEPTED_MAX + 5)
      await tx.update(triviaQuestions).set({ accepted }).where(eq(triviaQuestions.id, questionId))
      await this.score(tx, { ...q, accepted })
      await tx.update(triviaRounds).set({ activeAt: new Date(), version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, roundId))
      await notifyRound(tx, roundId)
    })
  }

  /** A bad question: nobody scores from it. One still open closes now. */
  async void(memberId: string, roundId: string, questionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const round = await this.ownRound(tx, memberId, roundId, true)
      if (round.status === 'published' || round.status === 'cancelled') throw new TriviaError('not_editable', 'The results are already out.')
      const [q] = await tx.select().from(triviaQuestions).where(and(eq(triviaQuestions.id, questionId), eq(triviaQuestions.roundId, roundId))).for('update')
      if (!q) throw new TriviaError('not_found', 'There is no such question.')
      if (q.voidedAt) return
      const now = await this.dbNow(tx)
      await tx.update(triviaQuestions).set({ voidedAt: now, judgedAt: q.judgedAt ?? now, firsts: [] }).where(eq(triviaQuestions.id, questionId))
      await tx.execute(sql`update games.trivia_answers set correct = false, place = null, points = 0 where question_id = ${questionId}`)
      const [left] = (await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from games.trivia_questions where round_id = ${roundId} and voided_at is null and judged_at is null`)).rows
      const ended = round.status === 'live' && (left?.n ?? 0) === 0
      await tx
        .update(triviaRounds)
        .set({ activeAt: new Date(), version: sql`${triviaRounds.version} + 1`, ...(ended ? { status: 'reviewing', endedAt: now } : {}) })
        .where(eq(triviaRounds.id, roundId))
      await notifyRound(tx, roundId)
    })
  }

  /** Ends a round early: questions not yet asked are dropped, one still open closes now. */
  async end(memberId: string, roundId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const round = await this.ownRound(tx, memberId, roundId, true)
      if (round.status !== 'live' && round.status !== 'scheduled') throw new TriviaError('not_editable', 'This round is not running.')
      await this.close(tx, round)
      await notifyRound(tx, roundId)
    })
    await this.judgeDue(roundId)
  }

  private async close(tx: Tx, round: RoundRow): Promise<void> {
    // Not yet open (counting down, or never asked): dropped. Open now: closes now and is judged as usual.
    await tx.execute(sql`
      update games.trivia_questions set voided_at = clock_timestamp(), judged_at = clock_timestamp(), opens_at = null, closes_at = null
      where round_id = ${round.id} and judged_at is null and voided_at is null and (opens_at is null or opens_at > clock_timestamp())`)
    await tx.execute(sql`
      update games.trivia_questions set closes_at = greatest(clock_timestamp(), opens_at + interval '1 millisecond')
      where round_id = ${round.id} and judged_at is null and voided_at is null and opens_at <= clock_timestamp() and closes_at > clock_timestamp()`)
    const [open] = (await tx.execute(sql`
      select 1 from games.trivia_questions where round_id = ${round.id} and judged_at is null and voided_at is null`)).rows
    await tx
      .update(triviaRounds)
      .set({ ...(open ? {} : { status: 'reviewing' }), endedAt: await this.dbNow(tx), activeAt: new Date(), version: sql`${triviaRounds.version} + 1` })
      .where(eq(triviaRounds.id, round.id))
  }

  /**
   * The results: places, points into the season, Game Score XP, and The Arbiter's
   * update to the thread with the top ten and who was first on each question. Once only.
   */
  async publishResults(memberId: string | null, roundId: string): Promise<void> {
    if (memberId) await this.ownRound(this.db, memberId, roundId)
    await this.judgeDue(roundId)
    const published = await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<RoundRow & { id: string }>(sql`
        select * from games.trivia_rounds where id = ${roundId} and status = 'reviewing' for update skip locked`)
      if (!rows[0]) return false
      const [left] = (await tx.execute(sql`select 1 from games.trivia_questions where round_id = ${roundId} and judged_at is null and voided_at is null`)).rows
      if (left) throw new TriviaError('busy', 'A question is still being judged. Try again in a moment.')
      const now = await this.dbNow(tx)
      const { rows: totals } = await tx.execute<{ member_id: string; points: number; right: number; firsts: number; time_ms: number }>(sql`
        select a.member_id, sum(a.points)::int as points, count(*) filter (where a.correct)::int as right,
               count(*) filter (where a.place = 1)::int as firsts,
               coalesce(sum(extract(epoch from (a.answered_at - q.opens_at)) * 1000) filter (where a.correct), 0)::int as time_ms
        from games.trivia_answers a join games.trivia_questions q on q.id = a.question_id
        where a.round_id = ${roundId} and q.voided_at is null
        group by a.member_id`)
      const places = roundPlaces(totals.map((t) => ({ memberId: t.member_id, points: Number(t.points), timeMs: Number(t.time_ms) })))
      const season = await ensureSeason(tx, now)
      for (const t of totals) {
        await tx.execute(sql`
          insert into games.trivia_results (round_id, member_id, points, right_count, firsts, time_ms, place)
          values (${roundId}, ${t.member_id}, ${t.points}::int, ${t.right}::int, ${t.firsts}::int, ${t.time_ms}::int, ${places.get(t.member_id)!}::int)
          on conflict do nothing`)
        await tx.execute(sql`
          insert into games.game_profiles (member_id, game, stats, created_at, updated_at)
          values (${t.member_id}, 'trivia', jsonb_build_object('rounds', 1, 'right', ${t.right}::int, 'firsts', ${t.firsts}::int, 'points', ${t.points}::int), ${now}, ${now})
          on conflict (member_id, game) do update set
            stats = games.game_profiles.stats || jsonb_build_object(
              'rounds', coalesce((games.game_profiles.stats->>'rounds')::int, 0) + 1,
              'right', coalesce((games.game_profiles.stats->>'right')::int, 0) + ${t.right}::int,
              'firsts', coalesce((games.game_profiles.stats->>'firsts')::int, 0) + ${t.firsts}::int,
              'points', coalesce((games.game_profiles.stats->>'points')::int, 0) + ${t.points}::int),
            updated_at = ${now}`)
        await tx.execute(sql`
          insert into games.season_scores (season_id, member_id, game, points, updated_at)
          values (${season.id}, ${t.member_id}, 'trivia', ${t.points}::int, ${now})
          on conflict (season_id, member_id, game) do update set
            points = games.season_scores.points + excluded.points,
            updated_at = case when excluded.points > 0 then excluded.updated_at else games.season_scores.updated_at end`)
      }
      await recordEvents(
        tx,
        totals.map((t) => ({
          game: 'trivia',
          kind: 'trivia_round_played',
          memberId: t.member_id,
          data: { round: roundId, points: Number(t.points), right: Number(t.right), firsts: Number(t.firsts), place: places.get(t.member_id) },
          createdAt: now,
        })),
      )
      await tx.update(triviaRounds).set({ status: 'published', publishedAt: now, version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, roundId))
      await notifyRound(tx, roundId)
      return true
    })
    if (published) await this.postResults(roundId).catch((err) => this.logger.warn(`posting round ${roundId}'s results: ${(err as Error).message}`))
  }

  /** The Arbiter's results, an update to the round's thread: the top ten, then a reply under it with the first right answer on each question and its time. Names, not @handles. */
  private async postResults(roundId: string): Promise<void> {
    const [round] = await this.db.select().from(triviaRounds).where(eq(triviaRounds.id, roundId))
    if (!round) return
    const { rows: top } = await this.db.execute<{ place: number; points: number; handle: string; display_name: string | null; active: boolean; minor: boolean }>(sql`
      select r.place, r.points, m.handle, m.display_name, (m.active and m.deleted_at is null) as active, ${isMinor(sql`m.id`)} as minor
      from games.trivia_results r join members m on m.id = r.member_id
      where r.round_id = ${roundId} and r.place <= ${RESULT_TOP}
      order by r.place, m.handle`)
    const [{ n }] = (await this.db.execute<{ n: number }>(sql`select count(*)::int as n from games.trivia_results where round_id = ${roundId}`)).rows as [{ n: number }]
    const results = top.length
      ? [
          `${round.title}: the results.`,
          top.map((r) => `${r.place}. ${publicName(r)} · ${r.points} ${r.points === 1 ? 'point' : 'points'}`).join('\n'),
          `${n} ${n === 1 ? 'member' : 'members'} played. Every question and answer: ${this.link(roundId)}`,
        ].join('\n\n')
      : `${round.title} is over. Nobody answered this time.`
    const { rows: firsts } = await this.db.execute<{ position: number; ms: number; handle: string; display_name: string | null; active: boolean; minor: boolean }>(sql`
      select q.position, (extract(epoch from (a.answered_at - q.opens_at)) * 1000)::int as ms,
             m.handle, m.display_name, (m.active and m.deleted_at is null) as active, ${isMinor(sql`m.id`)} as minor
      from games.trivia_questions q
      join games.trivia_answers a on a.question_id = q.id and a.place = 1
      join members m on m.id = a.member_id
      where q.round_id = ${roundId} and q.voided_at is null
      order by q.position`)
    // An update to the thread's story (docs/adr/0024): a reply would reach nobody's
    // feed, while an update brings the round back to the top of them, under its
    // announcement, and tells the story's followers. A thread taken down or never
    // posted leaves the results a post of their own.
    const alone = async () => this.posts.create(ARBITER_ID, results, { communitySlug: await this.postingSlug(round), anyMember: true })
    const posted = round.threadPostId
      ? await this.posts.create(ARBITER_ID, results, { storyOf: round.threadPostId }).catch((err) => {
          if (err instanceof StoryNotFoundError) return alone()
          throw err
        })
      : await alone()
    // The round already reads as published; pages still open look once more for this post.
    await this.db.update(triviaRounds).set({ resultPostId: posted.id, version: sql`${triviaRounds.version} + 1` }).where(eq(triviaRounds.id, roundId))
    await notifyRound(this.db, roundId)
    if (firsts.length) {
      const lines = firsts.map((f) => `Q${f.position}: ${publicName(f)}, ${seconds(Number(f.ms))}`)
      // A post holds 1,000 characters: the list stops short of that.
      let text = 'First right answer on each question:\n'
      for (const line of lines) {
        if (text.length + line.length + 1 > 950) break
        text += `\n${line}`
      }
      // Under the results, where talk about them goes.
      await this.posts.create(ARBITER_ID, text, { replyTo: posted.id })
    }
  }

  /**
   * The background work, once a minute (and on start): judges what is due, ends
   * rounds whose host has gone quiet, and publishes results nobody published.
   * Does nothing while Trivia is off for everyone.
   */
  async tick(): Promise<void> {
    if (!(await this.flags.onForAnyone('trivia'))) return
    await this.judgeDue()
    const now = await this.dbNow()
    const { rows: idle } = await this.db.execute<{ id: string }>(sql`
      select r.id from games.trivia_rounds r
      where r.status = 'live' and r.active_at < ${new Date(now.getTime() - IDLE_MS)}
        and not exists(select 1 from games.trivia_questions q where q.round_id = r.id and q.opens_at is not null and q.judged_at is null and q.voided_at is null)`)
    for (const { id } of idle) {
      await this.db.transaction(async (tx) => {
        const [round] = await tx.select().from(triviaRounds).where(eq(triviaRounds.id, id)).for('update', { skipLocked: true })
        if (round?.status === 'live') {
          await this.close(tx, round)
          await notifyRound(tx, id)
        }
      })
    }
    await this.judgeDue()
    const { rows: due } = await this.db.execute<{ id: string }>(sql`
      select id from games.trivia_rounds where status = 'reviewing' and ended_at < ${new Date(now.getTime() - REVIEW_MS)}`)
    for (const { id } of due) await this.publishResults(null, id).catch((err) => this.logger.warn(`publishing round ${id}: ${(err as Error).message}`))
  }

  // --- What members see ------------------------------------------------------------

  /** Whether the viewer may see a round: not a draft, and no block either way with its host. */
  async visible(viewerId: string, round: Pick<RoundRow, 'hostId' | 'status'>): Promise<boolean> {
    if (round.hostId === viewerId) return true
    if (round.status === 'draft') return false
    const { rows } = await this.db.execute<{ blocked: boolean }>(sql`select ${blockedEitherWay(viewerId, round.hostId)} as blocked`)
    return !rows[0]?.blocked
  }

  private person(r: { handle: string; display_name: string | null; avatar_media_id: string | null }): Person {
    return { handle: r.handle, displayName: r.display_name, avatar: avatarPath(r.avatar_media_id) }
  }

  /** Rounds live now, coming up and recently over, and the viewer's own as a host. */
  async list(viewerId: string): Promise<{ live: RoundCard[]; upcoming: RoundCard[]; recent: RoundCard[]; hosting: RoundCard[]; mayHost: boolean }> {
    const cards = async (where: ReturnType<typeof sql>, order: ReturnType<typeof sql>, limit: number) => {
      const { rows } = await this.db.execute<{
        id: string
        title: string
        status: string
        starts_at: Date | string
        seconds_per_question: number
        questions: number
        players: number
        your_place: number | null
        handle: string
        display_name: string | null
        avatar_media_id: string | null
        community_slug: string | null
        community_name: string | null
      }>(sql`
        select r.id, r.title, r.status, r.starts_at, r.seconds_per_question,
          (select count(*)::int from games.trivia_questions q where q.round_id = r.id and q.voided_at is null) as questions,
          (select count(distinct a.member_id)::int from games.trivia_answers a where a.round_id = r.id) as players,
          (select place from games.trivia_results x where x.round_id = r.id and x.member_id = ${viewerId}) as your_place,
          m.handle, m.display_name, m.avatar_media_id, c.slug as community_slug, c.name as community_name
        from games.trivia_rounds r join members m on m.id = r.host_id left join communities c on c.id = r.community_id
        where ${where} and not ${blockedEitherWay(viewerId, sql`r.host_id`)}
        order by ${order} limit ${limit}`)
      return rows.map(
        (r): RoundCard => ({
          id: r.id,
          title: r.title,
          status: r.status,
          startsAt: new Date(r.starts_at),
          questions: Number(r.questions),
          secondsPerQuestion: r.seconds_per_question,
          host: this.person(r),
          community: r.community_slug ? { slug: r.community_slug, name: r.community_name! } : null,
          players: Number(r.players),
          yourPlace: r.your_place,
        }),
      )
    }
    const [live, upcoming, recent, hosting, mayHost] = await Promise.all([
      cards(sql`r.status in ('live', 'reviewing')`, sql`r.starts_at`, 20),
      cards(sql`r.status = 'scheduled'`, sql`r.starts_at`, 20),
      cards(sql`r.status = 'published'`, sql`r.published_at desc`, 10),
      cards(sql`r.host_id = ${viewerId} and r.status in ('draft', 'scheduled', 'live', 'reviewing')`, sql`r.starts_at`, 30),
      this.mayHost(viewerId),
    ])
    return { live, upcoming, recent, hosting, mayHost }
  }

  /** A round as a player sees it now: never a question before it opens, never an answer before it closes. */
  async view(viewerId: string, roundId: string): Promise<RoundView | null> {
    const [round] = await this.db.select().from(triviaRounds).where(eq(triviaRounds.id, roundId))
    if (!round || !(await this.visible(viewerId, round))) return null
    const now = await this.dbNow()
    const [host] = (await this.db.execute<{ handle: string; display_name: string | null; avatar_media_id: string | null }>(sql`
      select handle, display_name, avatar_media_id from members where id = ${round.hostId}`)).rows
    const community = round.communityId
      ? (await this.db.select({ slug: communities.slug, name: communities.name }).from(communities).where(eq(communities.id, round.communityId)))[0] ?? null
      : null
    const questions = await this.db.select().from(triviaQuestions).where(eq(triviaQuestions.roundId, roundId)).orderBy(asc(triviaQuestions.position))
    const { rows: mine } = await this.db.execute<{ question_id: string; choice: number | null; text: string | null; correct: boolean | null; points: number; place: number | null; ms: number }>(sql`
      select a.question_id, a.choice, a.text, a.correct, a.points, a.place, (extract(epoch from (a.answered_at - q.opens_at)) * 1000)::int as ms
      from games.trivia_answers a join games.trivia_questions q on q.id = a.question_id
      where a.round_id = ${roundId} and a.member_id = ${viewerId}`)
    const myAnswer = new Map(mine.map((a) => [a.question_id, a]))
    const pictures = await this.pictures(questions)
    const picture = (q: QuestionRow): QuestionPicture | null => {
      const p = pictures.get(q.id)
      return p ? { src: p.src, alt: p.alt, width: p.width, height: p.height, animated: p.animated } : null
    }

    const live = questions.find((q) => q.opensAt && !q.judgedAt && !q.voidedAt)
    let current: CurrentQuestion | null = null
    if (live && round.status === 'live') {
      const opened = live.opensAt! <= now
      const a = myAnswer.get(live.id)
      current = {
        id: live.id,
        position: live.position,
        opensAt: live.opensAt!,
        closesAt: live.closesAt!,
        kind: live.kind as 'choice' | 'typed',
        prompt: opened ? live.prompt : null,
        choices: opened && live.kind === 'choice' ? choiceOrder(live.id, viewerId, live.choices!.length).map((i) => ({ id: i, text: live.choices![i]! })) : null,
        image: opened ? picture(live) : null,
        yourAnswer: a ? { choice: a.choice, text: a.text, ms: Number(a.ms) } : null,
      }
    }

    const judged = questions.filter((q) => q.judgedAt && (!q.voidedAt || q.opensAt))
    const lastQ = judged.sort((a, b) => b.position - a.position)[0]
    let last: Reveal | null = null
    if (lastQ) last = await this.reveal(lastQ, viewerId, myAnswer.get(lastQ.id) ?? null, lastQ.voidedAt ? null : picture(lastQ))

    const final = round.status === 'published'
    const { rows: board } = await this.db.execute<{ member_id: string; points: number; handle: string; display_name: string | null; avatar_media_id: string | null }>(
      final
        ? sql`
          select r.member_id, r.points, m.handle, m.display_name, m.avatar_media_id
          from games.trivia_results r join members m on m.id = r.member_id
          where r.round_id = ${roundId} and m.active and m.deleted_at is null and (m.id = ${viewerId} or not ${blockedEitherWay(viewerId, sql`m.id`)})
          order by r.place, r.time_ms, m.handle`
        : sql`
          select a.member_id, sum(a.points)::int as points, m.handle, m.display_name, m.avatar_media_id
          from games.trivia_answers a join members m on m.id = a.member_id
          where a.round_id = ${roundId} and a.correct is not null and m.active and m.deleted_at is null
            and (m.id = ${viewerId} or not ${blockedEitherWay(viewerId, sql`m.id`)})
          group by a.member_id, m.handle, m.display_name, m.avatar_media_id
          order by points desc, m.handle`,
    )
    const ranked: Standing[] = []
    board.forEach((r, i) => {
      const before = ranked[i - 1]
      const rank = before && before.points === Number(r.points) && !final ? before.rank : i + 1
      ranked.push({ ...this.person(r), rank, points: Number(r.points), you: r.member_id === viewerId })
    })
    if (final) {
      // Published places come from the results (ties on points broken by time).
      const { rows: places } = await this.db.execute<{ member_id: string; place: number }>(sql`select member_id, place from games.trivia_results where round_id = ${roundId}`)
      const placeOf = new Map(places.map((p) => [p.member_id, p.place]))
      board.forEach((r, i) => (ranked[i]!.rank = placeOf.get(r.member_id) ?? ranked[i]!.rank))
    }
    const yours = ranked.find((s) => s.you) ?? null
    return {
      id: round.id,
      title: round.title,
      status: round.status,
      startsAt: round.startsAt,
      secondsPerQuestion: round.secondsPerQuestion,
      questions: questions.filter((q) => !q.voidedAt || q.opensAt).length,
      host: this.person(host!),
      community,
      threadPostId: round.threadPostId,
      resultPostId: round.resultPostId,
      version: round.version,
      serverTime: now,
      you: { host: round.hostId === viewerId, canAnswer: round.hostId !== viewerId && !(await this.mayHost(viewerId)), points: yours?.points ?? 0 },
      current,
      last,
      standings: ranked.slice(0, STANDINGS_SIZE),
      yourStanding: yours,
      final,
    }
  }

  private async reveal(
    q: QuestionRow,
    viewerId: string,
    a: { choice: number | null; text: string | null; correct: boolean | null; points: number; place: number | null; ms: number } | null,
    image: QuestionPicture | null,
  ): Promise<Reveal> {
    const firstIds = (q.firsts as { memberId: string; ms: number }[]) ?? []
    const people = firstIds.length
      ? (await this.db.execute<{ id: string; handle: string; display_name: string | null; avatar_media_id: string | null }>(sql`
          select id, handle, display_name, avatar_media_id from members where id in (${sql.join(firstIds.map((f) => sql`${f.memberId}`), sql`, `)})`)).rows
      : []
    let choices: Reveal['choices'] = null
    if (q.kind === 'choice' && q.choices) {
      const { rows } = await this.db.execute<{ choice: number; n: number }>(sql`
        select choice, count(*)::int as n from games.trivia_answers where question_id = ${q.id} group by choice`)
      const counts = new Map(rows.map((r) => [r.choice, Number(r.n)]))
      choices = choiceOrder(q.id, viewerId, q.choices!.length).map((i) => ({ id: i, text: q.choices![i]!, count: counts.get(i) ?? 0, right: i === q.correctChoice }))
    }
    return {
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      kind: q.kind as 'choice' | 'typed',
      voided: Boolean(q.voidedAt),
      // Blank once a host's account is erased (their questions are their writing).
      answer: (q.kind === 'choice' ? q.choices?.[q.correctChoice ?? -1] : q.accepted?.[0]) ?? '',
      alsoAccepted: q.kind === 'typed' ? (q.accepted ?? []).slice(1) : [],
      explanation: q.explanation,
      choices,
      image,
      answered: q.answered,
      rightCount: q.rightCount,
      firsts: firstIds.flatMap((f) => {
        const p = people.find((r) => r.id === f.memberId)
        return p ? [{ ...this.person(p), ms: f.ms }] : []
      }),
      you: a ? { choice: a.choice, text: a.text, correct: Boolean(a.correct), points: a.points, place: a.place, ms: Number(a.ms) } : null,
    }
  }

  /** Everything about a round for its host: the questions with their answers, and the wrong typed answers to review. */
  async hostView(memberId: string, roundId: string): Promise<HostView> {
    const round = await this.ownRound(this.db, memberId, roundId)
    const now = await this.dbNow()
    const community = round.communityId
      ? (await this.db.select({ slug: communities.slug, name: communities.name }).from(communities).where(eq(communities.id, round.communityId)))[0] ?? null
      : null
    const questions = await this.db.select().from(triviaQuestions).where(eq(triviaQuestions.roundId, roundId)).orderBy(asc(triviaQuestions.position))
    const { rows: wrong } = await this.db.execute<{ question_id: string; normalised: string; sample: string; n: number; fast: number }>(sql`
      select a.question_id, a.normalised, min(a.text) as sample, count(*)::int as n,
        count(*) filter (where a.answered_at - q.opens_at < interval '600 milliseconds')::int as fast
      from games.trivia_answers a join games.trivia_questions q on q.id = a.question_id
      where a.round_id = ${roundId} and q.kind = 'typed' and q.judged_at is not null and a.correct = false
      group by a.question_id, a.normalised
      order by n desc`)
    const { rows: counts } = await this.db.execute<{ question_id: string; n: number }>(sql`
      select question_id, count(*)::int as n from games.trivia_answers where round_id = ${roundId} group by question_id`)
    const answered = new Map(counts.map((c) => [c.question_id, Number(c.n)]))
    const pictures = await this.pictures(questions)
    return {
      id: round.id,
      title: round.title,
      status: round.status,
      startsAt: round.startsAt,
      secondsPerQuestion: round.secondsPerQuestion,
      autoAdvance: round.autoAdvance,
      community,
      threadPostId: round.threadPostId,
      version: round.version,
      serverTime: now,
      endedAt: round.endedAt,
      publishesAt: round.status === 'reviewing' && round.endedAt ? new Date(round.endedAt.getTime() + REVIEW_MS) : null,
      questions: questions.map((q) => ({
        id: q.id,
        position: q.position,
        kind: q.kind as 'choice' | 'typed',
        prompt: q.prompt,
        choices: q.choices,
        correctChoice: q.correctChoice,
        accepted: q.accepted,
        explanation: q.explanation,
        image: pictures.get(q.id) ?? null,
        opensAt: q.opensAt,
        closesAt: q.closesAt,
        judged: Boolean(q.judgedAt),
        voided: Boolean(q.voidedAt),
        answered: answered.get(q.id) ?? 0,
        rightCount: q.rightCount,
        wrong: wrong.filter((w) => w.question_id === q.id).map((w) => ({ normalised: w.normalised, sample: w.sample, count: Number(w.n), fast: Number(w.fast) })),
      })),
    }
  }

  /**
   * Whether a long-poll should answer now instead of waiting. A new version always does.
   * A question opening by the clock is not a new version, so a page also says which open
   * question it already shows (`has`; '' for none): a request that reaches the server just
   * after a question opened, still showing the countdown, gets the question at once instead
   * of waiting until it closes. Pages that do not say (older apps) wait as before.
   */
  answersNow(view: Pick<RoundView, 'version' | 'status' | 'current'>, after: number, has?: string): boolean {
    if (after < 0 || view.version > after || view.status === 'published' || view.status === 'cancelled') return true
    return has !== undefined && view.current?.prompt != null && view.current.id !== has
  }

  /** The next moment a round changes by the clock alone (a question appears or closes), for the long-poll. */
  nextEdge(view: RoundView): Date | null {
    const c = view.current
    if (!c) return null
    return c.opensAt > view.serverTime ? c.opensAt : c.closesAt
  }
}
