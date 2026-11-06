import { communities, communityMemberships, communityTeams, competitionEntries, competitions, type Db, lichessAccounts, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import type { Env } from '../../env.js'
import { FeatureFlags } from '../../flags/feature-flags.js'
import { DB, ENV } from '../../tokens.js'
import { type CompetitionCard, CompetitionsService } from '../core/competitions.js'
import type { TokenBox } from '../core/token-box.js'
import { ChessError, LICHESS, TOKEN_BOX } from './chess-tokens.js'
import { LichessError, type LichessApi, type LichessTeam, TOURNAMENT_SCOPE, type TournamentKind } from './lichess.js'
import { arenaLengths, SWISS_ROUNDS, swissMinutes, TOURNAMENT_CONTROLS, tournamentControlById } from './time-controls.js'

// A community's Lichess team and its tournaments (docs/games/GAMES.md, docs/adr/0018
// phase 6). A moderator of the community who leads the team on Lichess links it
// and makes Arena and Swiss tournaments for it with their own Lichess token. Each
// tournament is a chess competition for the community. Games are played on
// lichess.org; HeyNaija reads the standings from Lichess's public results, places
// the HeyNaija members who played in Lichess's order, and finishes it as any
// competition (places, XP, The Arbiter's post in the community).

/** How long the team's cached name and size are trusted on its page. */
export const TEAM_REFRESH_MS = 3600_000
/** A live tournament's standings are read at most every CHESS_STANDINGS_EVERY_MS (two minutes), and at most this many tournaments a run, oldest read first. */
export const SYNC_MAX = 20
/** Players read from a tournament's results: plenty for a team's tournament. */
export const RESULTS_MAX = 1000
/** Lichess not finishing a tournament this long after it was due: finished from the last standings. */
export const FALLBACK_MS = 24 * 3600_000
/** A tournament starts at least this far ahead (time to join), and at most this far. */
export const START_MIN_MS = 10 * 60_000
export const START_MAX_MS = 60 * 24 * 3600_000

export type TournamentInput = {
  name: string
  kind: TournamentKind
  timeControl: string
  rated: boolean
  startsAt: Date
  /** Arena only. */
  minutes?: number
  /** Swiss only. */
  rounds?: number
}

export type TeamView = {
  community: { slug: string; name: string }
  team: { id: string; name: string; nbMembers: number; url: string } | null
  you: {
    /** A moderator of the community. */
    communityModerator: boolean
    siteModerator: boolean
    /** Their own Lichess account, if linked. */
    lichess: string | null
    /** May make tournaments: linked, and has said Lichess may let HeyNaija make them. */
    canCreate: boolean
    needsTournamentScope: boolean
    canLink: boolean
    canUnlink: boolean
  }
  controls: { id: string; speed: string; limit: number; increment: number; arenaMinutes: number[] }[]
  swissRounds: typeof SWISS_ROUNDS
  /** The community's chess tournaments: coming up and live, then recent. */
  tournaments: { current: CompetitionCard[]; recent: CompetitionCard[] }
}

/** The team id from what a moderator pasted: an id, or a team's address on Lichess. */
export function teamIdFrom(input: string): string | null {
  const text = input.trim()
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?lichess\.org\/team\/([^/?#\s]+)/i.exec(text)?.[1]
  const id = (fromUrl ?? text).toLowerCase()
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(id) ? id : null
}

type Row = typeof competitions.$inferSelect

@Injectable()
export class TeamsService {
  private readonly logger = new Logger('ChessTeams')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'LICHESS_URL' | 'CHESS_STANDINGS_EVERY_MS'>,
    @Inject(LICHESS) private readonly lichess: LichessApi,
    @Inject(TOKEN_BOX) private readonly box: TokenBox | null,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'onForAnyone'>,
    @Inject(CompetitionsService) private readonly competitions: Pick<CompetitionsService, 'finish' | 'markCancelled' | 'leadsCommunity' | 'list'>,
  ) {}

  // --- Who may do what ---------------------------------------------------------

  private async community(slug: string) {
    const [c] = await this.db
      .select({ id: communities.id, slug: communities.slug, name: communities.name })
      .from(communities)
      .where(and(eq(communities.slug, slug), eq(communities.active, true)))
    if (!c) throw new ChessError('not_found', 'There is no such community.')
    return c
  }

  private async roles(memberId: string, communityId: string) {
    const [row] = await this.db
      .select({ site: members.role, active: members.active, community: communityMemberships.role })
      .from(members)
      .leftJoin(communityMemberships, and(eq(communityMemberships.memberId, members.id), eq(communityMemberships.communityId, communityId)))
      .where(eq(members.id, memberId))
    const active = Boolean(row?.active)
    return { communityModerator: active && row?.community === 'moderator', siteModerator: active && row?.site === 'moderator' }
  }

  private async requireCommunityModerator(memberId: string, communityId: string) {
    if (!(await this.roles(memberId, communityId)).communityModerator) {
      throw new ChessError('not_moderator', 'Only this community’s moderators can do that.')
    }
  }

  private async account(memberId: string) {
    const [a] = await this.db.select().from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
    return a ?? null
  }

  private async requireLeader(lichessId: string, teamId: string): Promise<LichessTeam> {
    const team = await this.ask(() => this.lichess.team(teamId))
    if (!team) throw new ChessError('no_team', 'There is no Lichess team with that address.')
    if (!team.leaders.includes(lichessId)) {
      throw new ChessError('not_leader', 'Lichess does not list you as a leader of that team. Only a team leader can link it or make its tournaments.')
    }
    return team
  }

  private teamUrl(id: string) {
    return `${this.env.LICHESS_URL}/team/${id}`
  }

  // --- The team ----------------------------------------------------------------

  /** The community's chess page: its team, and what the viewer may do. Refreshes the team's name and size if an hour old. */
  async view(viewerId: string, slug: string, now = new Date()): Promise<TeamView> {
    const community = await this.community(slug)
    let [team] = await this.db.select().from(communityTeams).where(eq(communityTeams.communityId, community.id))
    if (team && now.getTime() - team.refreshedAt.getTime() > TEAM_REFRESH_MS) {
      const fresh = await this.lichess.team(team.lichessTeamId).catch(() => undefined)
      // Asked or not, it is not asked again for an hour.
      const [saved] = await this.db
        .update(communityTeams)
        .set({ refreshedAt: now, ...(fresh ? { teamName: fresh.name, nbMembers: fresh.nbMembers } : {}) })
        .where(eq(communityTeams.communityId, community.id))
        .returning()
      team = saved ?? team
    }
    const roles = await this.roles(viewerId, community.id)
    const account = await this.account(viewerId)
    const scoped = Boolean(account?.scopes.split(' ').includes(TOURNAMENT_SCOPE))
    const { current, recent } = await this.competitions.list(viewerId, { communityId: community.id, game: 'chess' })
    return {
      community: { slug: community.slug, name: community.name },
      team: team ? { id: team.lichessTeamId, name: team.teamName, nbMembers: team.nbMembers, url: this.teamUrl(team.lichessTeamId) } : null,
      you: {
        ...roles,
        lichess: account?.username ?? null,
        canLink: roles.communityModerator && Boolean(account),
        canUnlink: Boolean(team) && (roles.communityModerator || roles.siteModerator),
        canCreate: roles.communityModerator && Boolean(team) && scoped,
        needsTournamentScope: roles.communityModerator && Boolean(account) && !scoped,
      },
      controls: TOURNAMENT_CONTROLS.map((tc) => ({ id: tc.id, speed: tc.speed, limit: tc.limit, increment: tc.increment, arenaMinutes: arenaLengths(tc) })),
      swissRounds: SWISS_ROUNDS,
      tournaments: { current, recent },
    }
  }

  /** Links the community to a Lichess team the moderator leads; a different team replaces the old one. */
  async link(actorId: string, slug: string, teamInput: string, now = new Date()): Promise<void> {
    const community = await this.community(slug)
    await this.requireCommunityModerator(actorId, community.id)
    const account = await this.account(actorId)
    if (!account) throw new ChessError('not_linked', 'Connect your Lichess account first.')
    const teamId = teamIdFrom(teamInput)
    if (!teamId) throw new ChessError('invalid', 'Paste the team’s address on Lichess, like lichess.org/team/lagos-chess.')
    const team = await this.requireLeader(account.lichessId, teamId)
    const row = { lichessTeamId: team.id.toLowerCase(), teamName: team.name, nbMembers: team.nbMembers, linkedBy: actorId, linkedAt: now, refreshedAt: now }
    const linked = await this.db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ communityId: communityTeams.communityId })
        .from(communityTeams)
        .where(and(eq(communityTeams.lichessTeamId, row.lichessTeamId), sql`${communityTeams.communityId} <> ${community.id}`))
      if (taken) return false
      await tx
        .insert(communityTeams)
        .values({ communityId: community.id, ...row })
        .onConflictDoUpdate({ target: communityTeams.communityId, set: row })
      return true
    })
    if (!linked) throw new ChessError('team_taken', 'That Lichess team is already linked to another HeyNaija community.')
  }

  /** Unlinks the team. Tournaments already made run to the end and finish as usual. */
  async unlink(actorId: string, slug: string): Promise<void> {
    const community = await this.community(slug)
    const roles = await this.roles(actorId, community.id)
    if (!roles.communityModerator && !roles.siteModerator) throw new ChessError('not_moderator', 'Only this community’s moderators can do that.')
    await this.db.delete(communityTeams).where(eq(communityTeams.communityId, community.id))
  }

  // --- Tournaments -------------------------------------------------------------

  /** Checks what a moderator asked for against what Lichess and HeyNaija allow. */
  private checked(input: TournamentInput, now: Date) {
    const name = input.name.trim()
    // Lichess allows 2 to 30 characters (and adds "Arena" or "Swiss" itself).
    if (name.length < 2 || name.length > 30) throw new ChessError('invalid', 'Give it a name of 2 to 30 characters.')
    const tc = tournamentControlById(input.timeControl)
    if (!tc) throw new ChessError('invalid', 'Choose one of the time controls offered.')
    const start = input.startsAt.getTime()
    if (Number.isNaN(start) || start < now.getTime() + START_MIN_MS) throw new ChessError('invalid', 'Start it at least 10 minutes from now, so people can join.')
    if (start > now.getTime() + START_MAX_MS) throw new ChessError('invalid', 'Start it within the next 60 days.')
    if (input.kind === 'arena') {
      if (!input.minutes || !arenaLengths(tc).includes(input.minutes)) throw new ChessError('invalid', 'Choose one of the lengths offered for that time control.')
      return { tc, name, minutes: input.minutes, endsAt: new Date(start + input.minutes * 60_000) }
    }
    const rounds = input.rounds ?? 0
    if (!Number.isInteger(rounds) || rounds < SWISS_ROUNDS.min || rounds > SWISS_ROUNDS.max) {
      throw new ChessError('invalid', `Choose ${SWISS_ROUNDS.min} to ${SWISS_ROUNDS.max} rounds.`)
    }
    return { tc, name, rounds, endsAt: new Date(start + swissMinutes(tc, rounds) * 60_000) }
  }

  /** Makes the tournament on Lichess with the moderator's token, then its competition here. Returns the competition's id. */
  async createTournament(actorId: string, slug: string, input: TournamentInput, now = new Date()): Promise<string> {
    const community = await this.community(slug)
    await this.requireCommunityModerator(actorId, community.id)
    const [team] = await this.db.select().from(communityTeams).where(eq(communityTeams.communityId, community.id))
    if (!team) throw new ChessError('no_team', 'Link the community’s Lichess team first.')
    const plan = this.checked(input, now)
    const account = await this.account(actorId)
    if (!account) throw new ChessError('not_linked', 'Connect your Lichess account first.')
    if (!account.scopes.split(' ').includes(TOURNAMENT_SCOPE)) {
      throw new ChessError('needs_scope', 'Allow HeyNaija to make tournaments on Lichess for you first.')
    }
    if (!this.box) throw new ChessError('not_available', 'Lichess tournaments are not available here yet')
    const token = this.box.open(account.tokenBox, actorId)
    // Still a leader today: Lichess decides.
    await this.requireLeader(account.lichessId, team.lichessTeamId)
    const base = { name: plan.name, clockLimit: plan.tc.limit, clockIncrement: plan.tc.increment, rated: input.rated, startsAt: input.startsAt, teamId: team.lichessTeamId }
    const made = await this.ask(() =>
      this.lichess.createTournament(token, input.kind === 'arena' ? { ...base, kind: 'arena', minutes: plan.minutes! } : { ...base, kind: 'swiss', rounds: plan.rounds! }),
    )
    try {
      const [c] = await this.db
        .insert(competitions)
        .values({
          game: 'chess',
          name: plan.name,
          format: input.kind === 'arena' ? 'lichess_arena' : 'lichess_swiss',
          eligibility: 'community',
          communityId: community.id,
          entryOpensAt: now,
          entryClosesAt: plan.endsAt,
          startsAt: input.startsAt,
          endsAt: plan.endsAt,
          status: 'open',
          standingsSource: 'lichess',
          lichessTournamentId: made.id,
          settings: {
            kind: input.kind,
            teamId: team.lichessTeamId,
            teamName: team.teamName,
            clock: { limit: plan.tc.limit, increment: plan.tc.increment },
            ...(input.kind === 'arena' ? { minutes: plan.minutes } : { rounds: plan.rounds }),
            rated: input.rated,
          },
          createdBy: actorId,
          createdAt: now,
        })
        .returning({ id: competitions.id })
      return c!.id
    } catch (err) {
      // Nothing is left on Lichess that HeyNaija does not know about.
      await this.lichess.terminate(token, input.kind, made.id).catch(() => undefined)
      throw err
    }
  }

  /**
   * Cancels a tournament: its maker (while still a moderator of the community)
   * or a site moderator. It is ended on Lichess with the maker's token when that
   * works; `onLichess` false means it may still run there.
   */
  async cancelTournament(actorId: string, id: string): Promise<{ onLichess: boolean }> {
    const [c] = await this.db.select().from(competitions).where(eq(competitions.id, id))
    if (!c?.lichessTournamentId) throw new ChessError('not_found', 'There is no such tournament.')
    const [actor] = await this.db.select({ role: members.role, active: members.active }).from(members).where(eq(members.id, actorId))
    const site = actor?.role === 'moderator' && actor.active
    if (!site && !(await this.competitions.leadsCommunity(actorId, c))) throw new ChessError('not_moderator', 'Only the moderator who made it, or a site moderator, can cancel it.')
    if (c.status === 'finished' || c.status === 'cancelled') throw new ChessError('invalid', 'A finished or cancelled tournament cannot be cancelled.')
    await this.competitions.markCancelled(id)
    return { onLichess: await this.terminateQuietly(c) }
  }

  private async terminateQuietly(c: Row): Promise<boolean> {
    try {
      const account = await this.account(c.createdBy)
      if (!account || !this.box) return false
      await this.lichess.terminate(this.box.open(account.tokenBox, c.createdBy), kindOf(c), c.lichessTournamentId!)
      return true
    } catch (err) {
      this.logger.warn(`could not end tournament ${c.lichessTournamentId} on Lichess: ${(err as Error).message}`)
      return false
    }
  }

  // --- The job -----------------------------------------------------------------

  /**
   * Reads the standings of tournaments that have started, at most every
   * CHESS_STANDINGS_EVERY_MS each and SYNC_MAX a run, and finishes those Lichess has finished (or
   * that are a day overdue). Stops for the run if Lichess asks us to slow down.
   * Returns the competitions it finished. Does nothing while Games is off for everyone.
   */
  async sync(now = new Date()): Promise<string[]> {
    if (!(await this.flags.onForAnyone('games'))) return []
    const due = await this.db
      .select()
      .from(competitions)
      .where(
        and(
          eq(competitions.game, 'chess'),
          inArray(competitions.status, ['open', 'live']),
          sql`${competitions.startsAt} <= ${now}`,
          or(isNull(competitions.standingsAt), lt(competitions.standingsAt, new Date(now.getTime() - this.env.CHESS_STANDINGS_EVERY_MS))),
        ),
      )
      .orderBy(sql`${competitions.standingsAt} asc nulls first`, asc(competitions.startsAt))
      .limit(SYNC_MAX)
    const finished: string[] = []
    for (const c of due) {
      try {
        if (await this.syncOne(c, now)) finished.push(c.id)
      } catch (err) {
        if (err instanceof LichessError && err.kind === 'rate_limited') {
          this.logger.warn('Lichess asked us to slow down; tournament standings wait for the next run')
          break
        }
        this.logger.warn(`standings for tournament ${c.lichessTournamentId}: ${(err as Error).message}`)
        // Not asked again for two minutes, whatever went wrong.
        await this.db.update(competitions).set({ standingsAt: now }).where(eq(competitions.id, c.id))
        if (now.getTime() > c.endsAt.getTime() + FALLBACK_MS && (await this.finishUnfinished(c, now))) finished.push(c.id)
      }
    }
    return finished
  }

  /** One tournament: its state and results from Lichess, the HeyNaija members in it, and finishing if Lichess has. */
  private async syncOne(c: Row, now: Date): Promise<boolean> {
    const kind = kindOf(c)
    const state = await this.lichess.tournament(kind, c.lichessTournamentId!)
    const results = state.status === 'created' ? [] : await this.lichess.results(kind, c.lichessTournamentId!, RESULTS_MAX)
    const byName = new Map(results.map((r) => [r.username.toLowerCase(), r]))
    // Members of the community, active, with that Lichess account linked.
    const matched = byName.size
      ? await this.db
          .select({ memberId: lichessAccounts.memberId, lichessId: lichessAccounts.lichessId })
          .from(lichessAccounts)
          .innerJoin(members, eq(members.id, lichessAccounts.memberId))
          .innerJoin(communityMemberships, and(eq(communityMemberships.memberId, members.id), eq(communityMemberships.communityId, c.communityId!)))
          .where(and(inArray(lichessAccounts.lichessId, [...byName.keys()]), eq(members.active, true), isNull(members.deletedAt)))
      : []
    await this.db.transaction(async (tx) => {
      const ids = matched.map((m) => m.memberId)
      // Whoever is no longer there (unlinked, left the community) goes; the rest are as Lichess says now.
      await tx
        .delete(competitionEntries)
        .where(and(eq(competitionEntries.competitionId, c.id), ids.length ? notInArray(competitionEntries.memberId, ids) : undefined))
      for (const m of matched) {
        const r = byName.get(m.lichessId)!
        await tx
          .insert(competitionEntries)
          .values({ competitionId: c.id, memberId: m.memberId, enteredAt: now, score: r.score, sourceRank: r.rank })
          .onConflictDoUpdate({ target: [competitionEntries.competitionId, competitionEntries.memberId], set: { score: r.score, sourceRank: r.rank } })
      }
      await tx
        .update(competitions)
        .set({
          standingsAt: now,
          settings: sql`${competitions.settings} || ${JSON.stringify({ players: state.nbPlayers })}::jsonb`,
          ...(state.status !== 'created' && c.status === 'open' ? { status: 'live' as const } : {}),
        })
        .where(eq(competitions.id, c.id))
    })
    if (state.status === 'finished') return this.competitions.finish(c.id, now)
    if (now.getTime() > c.endsAt.getTime() + FALLBACK_MS) return this.finishUnfinished(c, now)
    return false
  }

  /** A day overdue and Lichess has not finished it: finished from the last standings read, and the result post says so. */
  private async finishUnfinished(c: Row, now: Date): Promise<boolean> {
    await this.db
      .update(competitions)
      .set({ settings: sql`${competitions.settings} || '{"unfinished":true}'::jsonb` })
      .where(eq(competitions.id, c.id))
    return this.competitions.finish(c.id, now)
  }

  private async ask<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (err) {
      if (!(err instanceof LichessError)) throw err
      switch (err.kind) {
        case 'unauthorized':
          throw new ChessError('reconnect', 'Lichess no longer accepts your link. Disconnect and connect Lichess again.')
        case 'rate_limited':
          throw new ChessError('lichess_busy', 'Lichess is busy. Try again in a minute.')
        case 'rejected':
          throw new ChessError('lichess_rejected', 'Lichess would not make that tournament. Check the details, or try again later (Lichess allows 12 a day).')
        case 'unavailable':
          throw new ChessError('lichess_unavailable', 'Lichess did not answer. Try again in a moment.')
      }
    }
  }
}

const kindOf = (c: Pick<Row, 'format'>): TournamentKind => (c.format === 'lichess_swiss' ? 'swiss' : 'arena')
