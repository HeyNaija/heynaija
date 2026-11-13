import { communities, communityMemberships, competitionEntries, competitionInvites, competitions, type Db, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { Env } from '../../env.js'
import { FeatureFlags } from '../../flags/feature-flags.js'
import { avatarPath } from '../../media/media.service.js'
import { blockedEitherWay, PostsService } from '../../posts/posts.service.js'
import { DB, ENV } from '../../tokens.js'
import { ARBITER_ID, GAME_NIGHT_SLUG } from '../chess/arena-ids.js'
import { gameBySlug } from './registry.js'
import { recordEvents } from './scoring.js'

// Competitions (docs/games/GAMES.md, docs/adr/0028 phases 5 and 6): Keno
// competitions are made by site moderators, entered by members and scored from
// play inside a window. Chess competitions are Lichess tournaments, made by a
// community's moderators for its Lichess team (chess/teams.ts), and scored from
// Lichess's results. Both finish with places, XP and a result post by The Arbiter.

export const ELIGIBILITIES = ['open', 'community', 'invite'] as const
export type Eligibility = (typeof ELIGIBILITIES)[number]

/** The formats each game offers, and what each means, in words the pages use. */
export const FORMATS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  keno: { keno_points: 'Most Keno points from tickets in rounds drawn during the competition.' },
  chess: {
    lichess_arena: 'An Arena on Lichess for the community’s team: play as many games as you can before the clock runs out. Lichess scores it.',
    lichess_swiss: 'A Swiss on Lichess for the community’s team: a set number of rounds, each against someone on a similar score. Lichess scores it.',
  },
}

/** Formats that are Lichess tournaments: made from a community's chess page, never the moderators' form. */
export const TOURNAMENT_FORMATS = new Set(['lichess_arena', 'lichess_swiss'])

/** How a score reads: Swiss points are kept doubled, so 9 is "4½". */
export function scoreText(format: string, score: number): string {
  if (format === 'lichess_swiss') {
    const whole = Math.floor(score / 2)
    return `${score % 2 ? (whole ? `${whole}½` : '½') : whole.toLocaleString('en-NG')} ${score <= 2 ? 'point' : 'points'}`
  }
  return `${score.toLocaleString('en-NG')} ${score === 1 ? 'point' : 'points'}`
}

export type CompetitionErrorCode = 'not_moderator' | 'invalid' | 'not_found' | 'not_eligible' | 'entry_closed' | 'not_editable'

export class CompetitionError extends Error {
  constructor(
    readonly code: CompetitionErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type CompetitionInput = {
  name: string
  game: string
  format: string
  eligibility: Eligibility
  /** For eligibility "community". */
  community?: string | null
  /** For eligibility "invite": who may enter. */
  invite?: string[]
  entryOpensAt: Date
  entryClosesAt: Date
  startsAt: Date
  endsAt: Date
}

export type Standing = {
  place: number | null
  handle: string
  displayName: string | null
  avatar: string | null
  score: number | null
  you: boolean
  /** In a Lichess tournament: their rank among everyone there, and their Lichess name. */
  lichess: { rank: number | null; username: string | null } | null
}

/** A chess competition's Lichess side, for its page. */
export type TournamentView = {
  kind: 'arena' | 'swiss'
  url: string
  teamUrl: string
  teamName: string | null
  clock: { limit: number; increment: number }
  minutes: number | null
  rounds: number | null
  rated: boolean
  /** Everyone playing on Lichess, HeyNaija or not, as last read. */
  players: number | null
  standingsAt: Date | null
  /** Finished from the last standings read, because Lichess had not finished it a day after it was due. */
  unfinished: boolean
}

export type CompetitionView = {
  id: string
  name: string
  game: string
  format: string
  formatText: string
  eligibility: Eligibility
  community: { slug: string; name: string } | null
  status: (typeof competitions.$inferSelect)['status']
  entryOpensAt: Date
  entryClosesAt: Date
  startsAt: Date
  endsAt: Date
  entrants: number
  resultPostId: string | null
  /** The viewer: whether they are in, and whether they may enter or withdraw now; and cancel it. */
  you: { entered: boolean; canEnter: boolean; canWithdraw: boolean; reason: string | null; moderator: boolean; canCancel: boolean }
  standings: Standing[]
  yourStanding: Standing | null
  invite: string[]
  chess: TournamentView | null
}

export type CompetitionCard = Pick<CompetitionView, 'id' | 'name' | 'game' | 'format' | 'status' | 'eligibility' | 'entryOpensAt' | 'entryClosesAt' | 'startsAt' | 'endsAt' | 'entrants' | 'resultPostId'>

const STANDINGS_SIZE = 50
const RESULT_TOP = 10

type Row = typeof competitions.$inferSelect

/**
 * The place a member came: rank by score among those who played (a score at all),
 * ties sharing a place, as on the leaderboards.
 */
export function placings(entries: { memberId: string; score: number | null }[]): Map<string, number> {
  const played = entries.filter((e) => e.score !== null).sort((a, b) => b.score! - a.score!)
  const places = new Map<string, number>()
  played.forEach((e, i) => places.set(e.memberId, i > 0 && played[i - 1]!.score === e.score ? places.get(played[i - 1]!.memberId)! : i + 1))
  return places
}

/** Lichess's order, by each member's rank there: places 1, 2, 3 with none shared (Lichess has broken the ties). */
export function inOrder(entries: { memberId: string; score: number | null; sourceRank: number | null }[]): Map<string, number> {
  const ranked = entries.filter((e) => e.sourceRank !== null && e.score !== null).sort((a, b) => a.sourceRank! - b.sourceRank!)
  return new Map(ranked.map((e, i) => [e.memberId, i + 1]))
}

@Injectable()
export class CompetitionsService {
  private readonly logger = new Logger('Competitions')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_PUBLIC_URL' | 'LICHESS_URL'>,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'onForAnyone'>,
    @Inject(PostsService) private readonly posts: Pick<PostsService, 'create'>,
  ) {}

  // --- Moderators ---------------------------------------------------------------

  private async requireModerator(memberId: string): Promise<void> {
    const [m] = await this.db.select({ role: members.role, active: members.active }).from(members).where(eq(members.id, memberId))
    if (m?.role !== 'moderator' || !m.active) throw new CompetitionError('not_moderator', 'Only site moderators can run competitions.')
  }

  async isModerator(memberId: string): Promise<boolean> {
    return this.requireModerator(memberId).then(
      () => true,
      () => false,
    )
  }

  /** Checks a competition's details and works out its community and invited members. */
  private async checked(input: CompetitionInput): Promise<{ communityId: string | null; invited: string[] }> {
    const name = input.name.trim()
    if (name.length < 3 || name.length > 80) throw new CompetitionError('invalid', 'Give it a name of 3 to 80 characters.')
    const game = gameBySlug(input.game)
    if (!game?.supportsCompetitions || !FORMATS[input.game]?.[input.format]) throw new CompetitionError('invalid', 'Choose a game and format that competitions support.')
    if (TOURNAMENT_FORMATS.has(input.format)) throw new CompetitionError('invalid', 'Chess tournaments are made by a community’s moderators, from its chess page.')
    const times = [input.entryOpensAt, input.entryClosesAt, input.startsAt, input.endsAt]
    if (times.some((t) => Number.isNaN(t.getTime()))) throw new CompetitionError('invalid', 'Give every date and time.')
    if (input.entryClosesAt < input.entryOpensAt) throw new CompetitionError('invalid', 'Entry must close after it opens.')
    if (input.endsAt <= input.startsAt) throw new CompetitionError('invalid', 'The competition must end after it starts.')
    if (input.entryClosesAt > input.endsAt) throw new CompetitionError('invalid', 'Entry must close before the competition ends.')
    let communityId: string | null = null
    if (input.eligibility === 'community') {
      const [c] = await this.db.select({ id: communities.id }).from(communities).where(and(eq(communities.slug, input.community ?? ''), eq(communities.active, true)))
      if (!c) throw new CompetitionError('invalid', 'Choose a community for a community competition.')
      communityId = c.id
    }
    let invited: string[] = []
    if (input.eligibility === 'invite') {
      const handles = [...new Set((input.invite ?? []).map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))]
      if (!handles.length) throw new CompetitionError('invalid', 'List who is invited, by handle.')
      const found = await this.db.select({ id: members.id, handle: members.handle }).from(members).where(and(inArray(sql`lower(${members.handle})`, handles), eq(members.active, true)))
      const missing = handles.filter((h) => !found.some((f) => f.handle.toLowerCase() === h))
      if (missing.length) throw new CompetitionError('invalid', `No member with the handle ${missing.map((h) => `@${h}`).join(', ')}.`)
      invited = found.map((f) => f.id)
    }
    return { communityId, invited }
  }

  /** Makes a competition as a draft, or published at once. */
  async create(actorId: string, input: CompetitionInput, publish: boolean, now = new Date()): Promise<string> {
    await this.requireModerator(actorId)
    const { communityId, invited } = await this.checked(input)
    return this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(competitions)
        .values({
          game: input.game,
          name: input.name.trim(),
          format: input.format,
          eligibility: input.eligibility,
          communityId,
          entryOpensAt: input.entryOpensAt,
          entryClosesAt: input.entryClosesAt,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: publish ? (input.startsAt <= now ? 'live' : 'open') : 'draft',
          standingsSource: input.format,
          createdBy: actorId,
          createdAt: now,
        })
        .returning({ id: competitions.id })
      if (invited.length) await tx.insert(competitionInvites).values(invited.map((memberId) => ({ competitionId: c!.id, memberId })))
      return c!.id
    })
  }

  /** Changes a competition's details while it is a draft, or published but not yet open for entry. */
  async update(actorId: string, id: string, input: CompetitionInput, now = new Date()): Promise<void> {
    await this.requireModerator(actorId)
    const c = await this.row(id)
    if (c.lichessTournamentId || !(c.status === 'draft' || (c.status === 'open' && c.entryOpensAt > now))) throw new CompetitionError('not_editable', 'It can only be changed before entry opens.')
    const { communityId, invited } = await this.checked(input)
    await this.db.transaction(async (tx) => {
      await tx
        .update(competitions)
        .set({ name: input.name.trim(), game: input.game, format: input.format, standingsSource: input.format, eligibility: input.eligibility, communityId, entryOpensAt: input.entryOpensAt, entryClosesAt: input.entryClosesAt, startsAt: input.startsAt, endsAt: input.endsAt })
        .where(eq(competitions.id, id))
      await tx.delete(competitionInvites).where(eq(competitionInvites.competitionId, id))
      if (invited.length) await tx.insert(competitionInvites).values(invited.map((memberId) => ({ competitionId: id, memberId })))
    })
  }

  async publish(actorId: string, id: string, now = new Date()): Promise<void> {
    await this.requireModerator(actorId)
    const c = await this.row(id)
    if (c.status !== 'draft') throw new CompetitionError('not_editable', 'Only a draft can be published.')
    if (c.endsAt <= now) throw new CompetitionError('invalid', 'It has already ended; change its dates first.')
    await this.db.update(competitions).set({ status: c.startsAt <= now ? 'live' : 'open' }).where(and(eq(competitions.id, id), eq(competitions.status, 'draft')))
  }

  async cancel(actorId: string, id: string): Promise<void> {
    await this.requireModerator(actorId)
    if ((await this.row(id)).lichessTournamentId) throw new CompetitionError('invalid', 'A Lichess tournament is cancelled from its chess page, so it ends on Lichess too.')
    await this.markCancelled(id)
  }

  /** Cancels it here, once whoever asked has been checked (by cancel, or by chess/teams.ts for a tournament). */
  async markCancelled(id: string): Promise<void> {
    const [done] = await this.db
      .update(competitions)
      .set({ status: 'cancelled' })
      .where(and(eq(competitions.id, id), notInArray(competitions.status, ['finished', 'cancelled'])))
      .returning({ id: competitions.id })
    if (!done) throw new CompetitionError('not_editable', 'A finished or cancelled competition cannot be cancelled.')
  }

  // --- Members ------------------------------------------------------------------

  private async row(id: string): Promise<Row> {
    const [c] = await this.db.select().from(competitions).where(eq(competitions.id, id))
    if (!c) throw new CompetitionError('not_found', 'There is no such competition.')
    return c
  }

  /** Why the member may not enter now, or null if they may. */
  private async refusal(memberId: string, c: Row, now: Date): Promise<string | null> {
    if (c.status !== 'open' && c.status !== 'live') return 'Entry is not open.'
    if (now < c.entryOpensAt) return 'Entry has not opened yet.'
    if (now > c.entryClosesAt) return 'Entry has closed.'
    if (c.eligibility === 'community') {
      const [m] = await this.db
        .select({ id: communityMemberships.memberId })
        .from(communityMemberships)
        .where(and(eq(communityMemberships.communityId, c.communityId!), eq(communityMemberships.memberId, memberId)))
      if (!m) return 'This competition is for members of its community. Join it to enter.'
    }
    if (c.eligibility === 'invite') {
      const [i] = await this.db
        .select({ id: competitionInvites.memberId })
        .from(competitionInvites)
        .where(and(eq(competitionInvites.competitionId, c.id), eq(competitionInvites.memberId, memberId)))
      if (!i) return 'This competition is by invitation only.'
    }
    return null
  }

  async enter(memberId: string, id: string, now = new Date()): Promise<void> {
    const c = await this.row(id)
    if (c.status === 'draft') throw new CompetitionError('not_found', 'There is no such competition.')
    if (c.lichessTournamentId) throw new CompetitionError('not_eligible', 'Join this tournament on Lichess. HeyNaija members who play in it show here.')
    const why = await this.refusal(memberId, c, now)
    if (why) throw new CompetitionError(why.startsWith('Entry') ? 'entry_closed' : 'not_eligible', why)
    await this.db.insert(competitionEntries).values({ competitionId: id, memberId, enteredAt: now }).onConflictDoNothing()
  }

  /** Leaves a competition while entry is still open; points already scored in it go too. */
  async withdraw(memberId: string, id: string, now = new Date()): Promise<void> {
    const c = await this.row(id)
    if (!(c.status === 'open' || c.status === 'live') || now > c.entryClosesAt) throw new CompetitionError('entry_closed', 'Entry has closed, so you are in it to the end.')
    await this.db.delete(competitionEntries).where(and(eq(competitionEntries.competitionId, id), eq(competitionEntries.memberId, memberId)))
  }

  // --- Reading ------------------------------------------------------------------

  /** Upcoming and live competitions, then recent finished ones. Drafts only for moderators. */
  async list(
    viewerId: string,
    only: { communityId?: string; game?: string } = {},
  ): Promise<{ current: CompetitionCard[]; recent: CompetitionCard[]; drafts: CompetitionCard[] }> {
    const moderator = await this.isModerator(viewerId)
    const narrowed = and(only.communityId ? eq(competitions.communityId, only.communityId) : undefined, only.game ? eq(competitions.game, only.game) : undefined)
    const card = (c: Row & { entrants: number }): CompetitionCard => ({
      id: c.id,
      name: c.name,
      game: c.game,
      format: c.format,
      status: c.status,
      eligibility: c.eligibility,
      entryOpensAt: c.entryOpensAt,
      entryClosesAt: c.entryClosesAt,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      entrants: c.entrants,
      resultPostId: c.resultPostId,
    })
    const entrants = sql<number>`(select count(*)::int from games.competition_entries e where e.competition_id = ${competitions.id})`
    const pick = (statuses: Row['status'][], order: 'asc' | 'desc', limit: number) =>
      this.db
        .select({ c: competitions, entrants })
        .from(competitions)
        .where(and(inArray(competitions.status, statuses), narrowed))
        .orderBy(order === 'asc' ? asc(competitions.startsAt) : desc(competitions.endsAt))
        .limit(limit)
    const [current, recent, drafts] = await Promise.all([pick(['live', 'open'], 'asc', 30), pick(['finished'], 'desc', 10), moderator ? pick(['draft'], 'asc', 30) : Promise.resolve([])])
    return {
      current: current.map((r) => card({ ...r.c, entrants: r.entrants })),
      recent: recent.map((r) => card({ ...r.c, entrants: r.entrants })),
      drafts: drafts.map((r) => card({ ...r.c, entrants: r.entrants })),
    }
  }

  async view(viewerId: string, id: string, now = new Date()): Promise<CompetitionView> {
    const c = await this.row(id)
    const moderator = await this.isModerator(viewerId)
    if (c.status === 'draft' && !moderator) throw new CompetitionError('not_found', 'There is no such competition.')
    const [community] = c.communityId
      ? await this.db.select({ slug: communities.slug, name: communities.name }).from(communities).where(eq(communities.id, c.communityId))
      : []
    const [entered] = await this.db
      .select({ id: competitionEntries.memberId })
      .from(competitionEntries)
      .where(and(eq(competitionEntries.competitionId, id), eq(competitionEntries.memberId, viewerId)))
    const tournament = Boolean(c.lichessTournamentId)
    const refusal = entered || tournament ? null : await this.refusal(viewerId, c, now)
    const entryOpen = (c.status === 'open' || c.status === 'live') && now >= c.entryOpensAt && now <= c.entryClosesAt
    type R = {
      member_id: string
      handle: string
      display_name: string | null
      avatar_media_id: string | null
      score: number | null
      placement: number | null
      place: string | number | null
      source_rank: number | null
      lichess_username: string | null
    }
    // A Lichess tournament is in Lichess's order (its tiebreaks), so nobody shares a place; Keno ranks by score.
    const order = tournament ? sql`source_rank nulls last` : sql`score desc nulls last`
    const place = tournament ? sql`case when source_rank is null then null else row_number() over (order by source_rank) end` : sql`case when score is null then null else rank() over (order by score desc nulls last) end`
    // Standings: blocks either way and mutes are hidden, as on the leaderboards; the viewer always sees their own row.
    const ranked = sql`
      with eligible as (
        select e.member_id, e.score, e.placement, e.source_rank, e.entered_at, m.handle, m.display_name, m.avatar_media_id, la.username as lichess_username
        from games.competition_entries e join members m on m.id = e.member_id
        left join games.lichess_accounts la on la.member_id = m.id
        where e.competition_id = ${id} and m.active and m.deleted_at is null
          and (m.id = ${viewerId} or (
            not ${blockedEitherWay(viewerId, sql`m.id`)}
            and not exists(select 1 from mutes mu where mu.muter_id = ${viewerId} and mu.muted_id = m.id)))
      )
      select *, ${place} as place from eligible`
    const top = await this.db.execute<R>(sql`select * from (${ranked}) r order by ${order}, entered_at, handle limit ${STANDINGS_SIZE}`)
    const [mine] = (await this.db.execute<R>(sql`select * from (${ranked}) r where member_id = ${viewerId}`)).rows
    const standing = (r: R): Standing => ({
      place: r.placement ?? (r.place === null ? null : Number(r.place)),
      handle: r.handle,
      displayName: r.display_name,
      avatar: avatarPath(r.avatar_media_id),
      score: r.score,
      you: r.member_id === viewerId,
      lichess: tournament ? { rank: r.source_rank, username: r.lichess_username } : null,
    })
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(competitionEntries).where(eq(competitionEntries.competitionId, id))
    const invite = moderator && c.eligibility === 'invite'
      ? (await this.db.select({ handle: members.handle }).from(competitionInvites).innerJoin(members, eq(members.id, competitionInvites.memberId)).where(eq(competitionInvites.competitionId, id))).map((r) => r.handle)
      : []
    return {
      id: c.id,
      name: c.name,
      game: c.game,
      format: c.format,
      formatText: FORMATS[c.game]?.[c.format] ?? c.format,
      eligibility: c.eligibility,
      community: community ?? null,
      status: c.status,
      entryOpensAt: c.entryOpensAt,
      entryClosesAt: c.entryClosesAt,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      entrants: n,
      resultPostId: c.resultPostId,
      you: {
        entered: Boolean(entered),
        canEnter: !tournament && !entered && !refusal,
        canWithdraw: !tournament && Boolean(entered) && entryOpen,
        reason: entered ? null : refusal,
        moderator,
        canCancel: c.status !== 'finished' && c.status !== 'cancelled' && (moderator || (tournament && (await this.leadsCommunity(viewerId, c)))),
      },
      standings: top.rows.map(standing),
      yourStanding: mine ? standing(mine) : null,
      invite,
      chess: tournament ? this.tournamentView(c) : null,
    }
  }

  /** Whether the member made this tournament and still moderates its community: they may cancel it. */
  async leadsCommunity(memberId: string, c: Pick<Row, 'createdBy' | 'communityId'>): Promise<boolean> {
    if (c.createdBy !== memberId || !c.communityId) return false
    const [m] = await this.db
      .select({ id: communityMemberships.memberId })
      .from(communityMemberships)
      .innerJoin(members, eq(members.id, communityMemberships.memberId))
      .where(and(eq(communityMemberships.communityId, c.communityId), eq(communityMemberships.memberId, memberId), eq(communityMemberships.role, 'moderator'), eq(members.active, true)))
    return Boolean(m)
  }

  private tournamentView(c: Row): TournamentView {
    const s = c.settings as {
      kind?: 'arena' | 'swiss'
      teamId?: string
      teamName?: string
      clock?: { limit: number; increment: number }
      minutes?: number
      rounds?: number
      rated?: boolean
      players?: number
      unfinished?: boolean
    }
    const kind = s.kind ?? (c.format === 'lichess_swiss' ? 'swiss' : 'arena')
    return {
      kind,
      url: `${this.env.LICHESS_URL}/${kind === 'arena' ? 'tournament' : 'swiss'}/${c.lichessTournamentId}`,
      teamUrl: `${this.env.LICHESS_URL}/team/${s.teamId ?? ''}`,
      teamName: s.teamName ?? null,
      clock: s.clock ?? { limit: 0, increment: 0 },
      minutes: s.minutes ?? null,
      rounds: s.rounds ?? null,
      rated: s.rated ?? true,
      players: s.players ?? null,
      standingsAt: c.standingsAt,
      unfinished: Boolean(s.unfinished),
    }
  }

  // --- The job ------------------------------------------------------------------

  /**
   * Moves competitions on by the clock: open → live when they start; finished
   * once they have ended and every Keno round drawing before the end is drawn.
   * Safe to run any number of times. Does nothing while Games is off for everyone.
   */
  async tick(now = new Date()): Promise<string[]> {
    if (!(await this.flags.onForAnyone('games'))) return []
    await this.db.update(competitions).set({ status: 'live' }).where(and(eq(competitions.status, 'open'), sql`${competitions.startsAt} <= ${now}`))
    const due = await this.db
      .select({ id: competitions.id })
      .from(competitions)
      .where(
        and(
          inArray(competitions.status, ['open', 'live']),
          // Lichess tournaments finish when Lichess says (chess/teams.ts).
          eq(competitions.format, 'keno_points'),
          sql`${competitions.endsAt} <= ${now}`,
          sql`not exists(select 1 from games.keno_rounds r where r.drawn_at is null and r.draws_at < ${competitions.endsAt})`,
        ),
      )
    const finished: string[] = []
    for (const { id } of due) if (await this.finish(id, now)) finished.push(id)
    return finished
  }

  /**
   * Finishes a competition once: places by score (ties share), or for a Lichess
   * tournament in Lichess's order; one `competition_placed` event per member who
   * played, with its XP, then The Arbiter's result post. Nobody played: finished
   * with no post.
   */
  async finish(id: string, now = new Date()): Promise<boolean> {
    const done = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(competitions)
        .where(and(eq(competitions.id, id), inArray(competitions.status, ['open', 'live'])))
        .for('update', { skipLocked: true })
      if (!c) return null
      const entries = await tx.select().from(competitionEntries).where(eq(competitionEntries.competitionId, id))
      const places = c.lichessTournamentId ? inOrder(entries) : placings(entries)
      for (const [memberId, placement] of places) {
        await tx.update(competitionEntries).set({ placement }).where(and(eq(competitionEntries.competitionId, id), eq(competitionEntries.memberId, memberId)))
      }
      await recordEvents(
        tx,
        [...places].map(([memberId, placement]) => ({
          game: c.game,
          kind: 'competition_placed',
          memberId,
          competitionId: id,
          data: { competitionId: id, name: c.name, placement, score: entries.find((e) => e.memberId === memberId)!.score, players: places.size },
          createdAt: now,
        })),
      )
      await tx.update(competitions).set({ status: 'finished' }).where(eq(competitions.id, id))
      return { c, players: places.size }
    })
    if (!done) return false
    if (done.players) await this.postResult(done.c).catch((err) => this.logger.warn(`no result post for competition ${id}: ${(err as Error).message}`))
    return true
  }

  /** The Arbiter's result post: in the competition's community if it has one, else Game Night. Names, not @handles, so nobody is pinged. */
  private async postResult(c: Row): Promise<void> {
    const { rows } = await this.db.execute<{ placement: number; score: number; handle: string; display_name: string | null }>(sql`
      select e.placement, e.score, m.handle, m.display_name from games.competition_entries e join members m on m.id = e.member_id
      where e.competition_id = ${c.id} and e.placement is not null and e.placement <= ${RESULT_TOP} and m.active and m.deleted_at is null
      order by e.placement, m.handle`)
    const [{ n } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, c.id), sql`${competitionEntries.score} is not null`))
    const lines = rows.map((r) => `${r.placement}. ${(r.display_name ?? r.handle).slice(0, 40)} · ${scoreText(c.format, Number(r.score))}`)
    const chess = c.lichessTournamentId ? this.tournamentView(c) : null
    const text = [
      `${c.name} is over. The results${chess ? ' for HeyNaija members' : ''}:`,
      lines.join('\n'),
      ...(chess?.unfinished ? ['Lichess had not finished it a day after it was due to end, so these are the last standings HeyNaija read.'] : []),
      `${n} ${n === 1 ? 'member' : 'members'} took part. Full standings: ${this.env.WEB_PUBLIC_URL}/games/competitions/${c.id}`,
      ...(chess ? [`On Lichess: ${chess.url}`] : []),
    ].join('\n\n')
    let slug = GAME_NIGHT_SLUG
    if (c.communityId) {
      const [community] = await this.db.select({ slug: communities.slug }).from(communities).where(and(eq(communities.id, c.communityId), eq(communities.active, true)))
      if (community) slug = community.slug
    }
    await this.posts.create(ARBITER_ID, text, {
      communitySlug: slug,
      anyMember: true,
      alongside: async (tx, postId) => {
        await tx.update(competitions).set({ resultPostId: postId }).where(eq(competitions.id, c.id))
      },
    })
  }
}
