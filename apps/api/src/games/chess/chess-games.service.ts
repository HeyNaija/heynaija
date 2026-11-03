import { chessGames, type Db, gameEvents, lichessAccounts, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { Env } from '../../env.js'
import { avatarPath } from '../../media/media.service.js'
import { notify } from '../../notifications/notifications.service.js'
import { blockedEitherWay, PostsService } from '../../posts/posts.service.js'
import { DB, ENV } from '../../tokens.js'
import type { TokenBox } from '../core/token-box.js'
import { ARBITER_ID, ARENA_SLUG } from './arena-ids.js'
import { ChessError, LICHESS, TOKEN_BOX } from './chess-tokens.js'
import { publishGameChange } from './game-events.js'
import { type BoardState, LichessError, type LichessApi, RUNNING_STATUSES } from './lichess.js'
import { describeTime, SPEED_NAMES, type Speed } from './time-controls.js'

export type Side = 'white' | 'black'
type Player = { handle: string; displayName: string | null; avatar: string | null; rating: number | null; provisional: boolean }

export type GameView = {
  id: string
  white: Player
  black: Player
  /** The colour the viewer plays, or null for a spectator. */
  you: Side | null
  rated: boolean
  speed: Speed
  time: string
  /** Seconds a side starts with, and gains a move; null for correspondence. */
  clock: { limit: number; increment: number } | null
  days: number | null
  status: string
  finished: boolean
  winner: Side | null
  moves: string[]
  /** Each clock in milliseconds as of `clockAt`; the page counts down from there. */
  whiteMs: number | null
  blackMs: number | null
  clockAt: Date | null
  drawOffer: Side | null
  version: number
  startedAt: Date
  finishedAt: Date | null
  threadPostId: string | null
  resultPostId: string | null
  ratingsAfter: Record<string, { before: number | null; after: number | null }> | null
  lichessUrl: string
}

export type LiveGame = { id: string; white: Player; black: Player; speed: Speed; time: string; rated: boolean; startedAt: Date; moveCount: number }

/** How a finished game reads: "Ada won by checkmate", "Drawn by agreement". */
export function resultLine(g: { status: string; winner: Side | null }, names: Record<Side, string>): string {
  const how: Record<string, string> = {
    mate: 'by checkmate',
    resign: 'by resignation',
    outoftime: 'on time',
    timeout: 'as the other player left the game',
  }
  if (g.status === 'aborted') return 'Game aborted before it got going'
  if (g.status === 'noStart') return 'Game cancelled: the first move was not made in time'
  if (g.winner) return `${names[g.winner]} won ${how[g.status] ?? ''}`.trim()
  if (g.status === 'stalemate') return 'Drawn by stalemate'
  if (g.status === 'draw') return 'Drawn'
  return 'Game over'
}

const isRunning = (status: string) => (RUNNING_STATUSES as readonly string[]).includes(status)

/**
 * Games made from accepted challenges (docs/adr/0018, phase 3): what the page
 * shows, the players' moves and decisions, the state the watcher reads from
 * Lichess, and what happens once a game ends. Lichess decides what is legal and
 * how it ended; this keeps a copy and tells the pages.
 */
@Injectable()
export class ChessGamesService {
  private readonly logger = new Logger('ChessGames')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_PUBLIC_URL' | 'LICHESS_URL'>,
    @Inject(LICHESS) private readonly lichess: LichessApi,
    @Inject(TOKEN_BOX) private readonly box: TokenBox | null,
    @Inject(PostsService) private readonly posts: Pick<PostsService, 'create'>,
  ) {}

  // --- Starting ---------------------------------------------------------------

  /**
   * After a challenge is accepted and the game made on Lichess: keeps the game,
   * tells the challenger it has started, and opens The Arbiter's thread in Chess
   * Arena if the challenger asked for one. A thread that cannot be made does not
   * stop the game.
   */
  async start(
    c: { id: string; challengerId: string; challengedId: string; rated: boolean; clockLimit: number | null; clockIncrement: number | null; days: number | null; openThread: boolean },
    gameId: string,
    white: Side,
    now = new Date(),
  ): Promise<void> {
    const whiteId = white === 'white' ? c.challengerId : c.challengedId
    const blackId = whiteId === c.challengerId ? c.challengedId : c.challengerId
    await this.db.transaction(async (tx) => {
      await tx
        .insert(chessGames)
        .values({ id: gameId, challengeId: c.id, whiteId, blackId, rated: c.rated, clockLimit: c.clockLimit, clockIncrement: c.clockIncrement, days: c.days, status: 'started', startedAt: now })
        .onConflictDoNothing()
      await notify(tx, [{ recipientId: c.challengerId, kind: 'chess_game_started', actorId: c.challengedId, gameId }])
    })
    if (c.openThread) await this.openThread(gameId).catch((err) => this.logger.warn(`no thread for game ${gameId}: ${(err as Error).message}`))
  }

  /** The Arbiter's post in Chess Arena for a game: who, what game, and where to watch. Names, not @mentions, so nobody is pinged. */
  private async openThread(gameId: string): Promise<void> {
    const g = await this.row(gameId)
    if (!g || g.threadPostId) return
    const names = await this.names(g.whiteId, g.blackId)
    const { speed, label } = describeTime(g)
    const text = `${names.white} (white) vs ${names.black} (black) · ${g.rated ? 'rated' : 'casual'} ${SPEED_NAMES[speed]} ${label}.\n\nWatch it live: ${this.env.WEB_PUBLIC_URL}/games/chess/games/${gameId}\n\nThe players see the replies here once the game is over.`
    await this.posts.create(ARBITER_ID, text, {
      communitySlug: ARENA_SLUG,
      anyMember: true,
      alongside: async (tx, postId) => {
        await tx.update(chessGames).set({ threadPostId: postId }).where(eq(chessGames.id, gameId))
      },
    })
  }

  // --- Reading ----------------------------------------------------------------

  private async row(gameId: string) {
    const [g] = await this.db.select().from(chessGames).where(eq(chessGames.id, gameId))
    return g
  }

  private async names(whiteId: string, blackId: string): Promise<Record<Side, string>> {
    const rows = await this.db.select({ id: members.id, handle: members.handle, name: members.displayName }).from(members).where(or(eq(members.id, whiteId), eq(members.id, blackId)))
    // The handle without its @: an @handle in The Arbiter's post would be a mention, and ping the player.
    const name = (id: string) => {
      const m = rows.find((r) => r.id === id)
      return m ? (m.name ?? m.handle) : 'A member'
    }
    return { white: name(whiteId), black: name(blackId) }
  }

  /** A game as `viewerId` may see it; null when it does not exist, or either player is suspended or blocked either way. */
  async view(viewerId: string, gameId: string): Promise<GameView | null> {
    const { rows } = await this.db.execute<{
      g: typeof chessGames.$inferSelect
      wh: string
      wn: string | null
      wa: string | null
      wr: Record<string, { rating: number; provisional: boolean }> | null
      bh: string
      bn: string | null
      ba: string | null
      br: Record<string, { rating: number; provisional: boolean }> | null
    }>(sql`
      select row_to_json(g) as g,
        w.handle as wh, w.display_name as wn, w.avatar_media_id as wa, wl.ratings as wr,
        b.handle as bh, b.display_name as bn, b.avatar_media_id as ba, bl.ratings as br
      from games.chess_games g
      join members w on w.id = g.white_id
      join members b on b.id = g.black_id
      left join games.lichess_accounts wl on wl.member_id = g.white_id
      left join games.lichess_accounts bl on bl.member_id = g.black_id
      where g.id = ${gameId} and w.active and b.active
        and not ${blockedEitherWay(viewerId, sql`g.white_id`)} and not ${blockedEitherWay(viewerId, sql`g.black_id`)}`)
    const r = rows[0]
    if (!r) return null
    const g = r.g as unknown as Record<string, unknown>
    const { speed, label } = describeTime({ clockLimit: g.clock_limit as number | null, clockIncrement: g.clock_increment as number | null, days: g.days as number | null })
    const player = (handle: string, name: string | null, avatar: string | null, ratings: typeof r.wr): Player => ({
      handle,
      displayName: name,
      avatar: avatarPath(avatar),
      rating: ratings?.[speed]?.rating ?? null,
      provisional: Boolean(ratings?.[speed]?.provisional),
    })
    const date = (v: unknown) => (v ? new Date(v as string) : null)
    return {
      id: gameId,
      white: player(r.wh, r.wn, r.wa, r.wr),
      black: player(r.bh, r.bn, r.ba, r.br),
      you: viewerId === g.white_id ? 'white' : viewerId === g.black_id ? 'black' : null,
      rated: g.rated as boolean,
      speed,
      time: label,
      clock: g.days == null ? { limit: g.clock_limit as number, increment: g.clock_increment as number } : null,
      days: (g.days as number | null) ?? null,
      status: g.status as string,
      finished: g.finished_at != null,
      winner: (g.winner as Side | null) ?? null,
      moves: (g.moves as string) ? (g.moves as string).split(' ') : [],
      whiteMs: (g.white_ms as number | null) ?? null,
      blackMs: (g.black_ms as number | null) ?? null,
      clockAt: date(g.clock_at),
      drawOffer: (g.draw_offer as Side | null) ?? null,
      version: g.version as number,
      startedAt: date(g.started_at)!,
      finishedAt: date(g.finished_at),
      threadPostId: (g.thread_post_id as string | null) ?? null,
      resultPostId: (g.result_post_id as string | null) ?? null,
      ratingsAfter: (g.ratings_after as GameView['ratingsAfter']) ?? null,
      lichessUrl: `${this.env.LICHESS_URL}/${gameId}`,
    }
  }

  /** Games being played now, newest first, without anyone the viewer has blocked or is blocked by. */
  async live(viewerId: string, limit = 20): Promise<LiveGame[]> {
    const { rows } = await this.db.execute<{
      id: string
      rated: boolean
      clock_limit: number | null
      clock_increment: number | null
      days: number | null
      started_at: Date
      moves: string
      wh: string
      wn: string | null
      wa: string | null
      bh: string
      bn: string | null
      ba: string | null
    }>(sql`
      select g.id, g.rated, g.clock_limit, g.clock_increment, g.days, g.started_at, g.moves,
        w.handle as wh, w.display_name as wn, w.avatar_media_id as wa, b.handle as bh, b.display_name as bn, b.avatar_media_id as ba
      from games.chess_games g
      join members w on w.id = g.white_id
      join members b on b.id = g.black_id
      where g.finished_at is null and w.active and b.active
        and not ${blockedEitherWay(viewerId, sql`g.white_id`)} and not ${blockedEitherWay(viewerId, sql`g.black_id`)}
      order by g.started_at desc limit ${limit}`)
    return rows.map((r) => {
      const { speed, label } = describeTime({ clockLimit: r.clock_limit, clockIncrement: r.clock_increment, days: r.days })
      const p = (handle: string, name: string | null, avatar: string | null): Player => ({ handle, displayName: name, avatar: avatarPath(avatar), rating: null, provisional: false })
      return {
        id: r.id,
        white: p(r.wh, r.wn, r.wa),
        black: p(r.bh, r.bn, r.ba),
        speed,
        time: label,
        rated: r.rated,
        startedAt: new Date(r.started_at),
        moveCount: r.moves ? r.moves.split(' ').length : 0,
      }
    })
  }

  /** The game `handle` is playing now, if the viewer may watch it. */
  async playingNow(viewerId: string, handle: string): Promise<{ id: string } | null> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select g.id from games.chess_games g
      join members m on m.handle = ${handle.toLowerCase()} and m.id in (g.white_id, g.black_id)
      join members w on w.id = g.white_id
      join members b on b.id = g.black_id
      where g.finished_at is null and w.active and b.active
        and not ${blockedEitherWay(viewerId, sql`g.white_id`)} and not ${blockedEitherWay(viewerId, sql`g.black_id`)}
      order by g.started_at desc limit 1`)
    return rows[0] ?? null
  }

  /** Unfinished games, for the watcher to pick up when the API starts. */
  async unfinished(): Promise<string[]> {
    return (await this.db.select({ id: chessGames.id }).from(chessGames).where(isNull(chessGames.finishedAt))).map((g) => g.id)
  }

  // --- Playing ----------------------------------------------------------------

  /** A player's move, draw answer, resignation or abort, sent to Lichess with their own token. Spectators get not_found. */
  async act(memberId: string, gameId: string, action: { kind: 'move'; uci: string } | { kind: 'draw'; answer: 'offer' | 'accept' | 'decline' } | { kind: 'resign' } | { kind: 'abort' }): Promise<void> {
    const box = this.box
    if (!box) throw new ChessError('not_available', 'Chess is not available here yet.')
    await this.db.transaction(async (tx) => {
      const [g] = await tx.select().from(chessGames).where(eq(chessGames.id, gameId))
      if (!g || (g.whiteId !== memberId && g.blackId !== memberId)) throw new ChessError('not_found', 'That game is not there.')
      if (g.finishedAt) throw new ChessError('game_over', 'That game is over.')
      // One Lichess request at a time per member (GAMES.md).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`lichess/${memberId}`}, 0))`)
      const [account] = await tx.select({ tokenBox: lichessAccounts.tokenBox }).from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
      if (!account) throw new ChessError('not_linked', 'Connect your Lichess account again to play.')
      const token = box.open(account.tokenBox, memberId)
      try {
        switch (action.kind) {
          case 'move':
            return await this.lichess.move(token, gameId, action.uci)
          case 'draw':
            return await this.lichess.draw(token, gameId, action.answer === 'decline' ? 'no' : 'yes')
          case 'resign':
            return await this.lichess.resign(token, gameId)
          case 'abort':
            return await this.lichess.abort(token, gameId)
        }
      } catch (err) {
        if (err instanceof LichessError && err.kind === 'rejected') {
          throw new ChessError(action.kind === 'move' ? 'illegal_move' : 'lichess_rejected', action.kind === 'move' ? 'Lichess did not accept that move.' : 'Lichess would not do that now.')
        }
        if (err instanceof LichessError && err.kind === 'unauthorized') throw new ChessError('reconnect', 'Lichess no longer accepts your connection. Disconnect and connect Lichess again.')
        if (err instanceof LichessError && err.kind === 'rate_limited') throw new ChessError('lichess_busy', 'Lichess is busy. Try again in a moment.')
        if (err instanceof LichessError) throw new ChessError('lichess_unavailable', 'Lichess did not answer. Try again in a moment.')
        throw err
      }
    })
  }

  /** A token that can read a game's stream: white's, or black's if white has unlinked. */
  async streamToken(gameId: string): Promise<string | null> {
    if (!this.box) return null
    const g = await this.row(gameId)
    if (!g) return null
    for (const memberId of [g.whiteId, g.blackId]) {
      const [account] = await this.db.select({ tokenBox: lichessAccounts.tokenBox }).from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
      if (account) return this.box.open(account.tokenBox, memberId)
    }
    return null
  }

  // --- Lichess's state --------------------------------------------------------

  /**
   * What the Board API stream says now: kept if anything changed, and every page
   * told. When it says the game is over, the game is finished, once. Returns
   * whether the game has ended.
   */
  async applyState(gameId: string, state: BoardState, now = new Date()): Promise<boolean> {
    const drawOffer: Side | null = state.wdraw ? 'white' : state.bdraw ? 'black' : null
    const running = isRunning(state.status)
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(chessGames)
        .set({
          moves: state.moves,
          status: state.status,
          winner: state.winner ?? null,
          whiteMs: state.wtime ?? null,
          blackMs: state.btime ?? null,
          clockAt: now,
          drawOffer,
          version: sql`${chessGames.version} + 1`,
        })
        .where(
          and(
            eq(chessGames.id, gameId),
            isNull(chessGames.finishedAt),
            sql`(${chessGames.moves}, ${chessGames.status}, ${chessGames.winner}, ${chessGames.drawOffer}, ${chessGames.whiteMs}, ${chessGames.blackMs})
              is distinct from (${state.moves}, ${state.status}, ${state.winner ?? null}, ${drawOffer}, ${state.wtime ?? null}::int, ${state.btime ?? null}::int)`,
          ),
        )
        .returning({ id: chessGames.id })
      if (updated) await publishGameChange(tx, gameId)
    })
    if (!running) await this.finish(gameId, now)
    return !running
  }

  /**
   * Once a game is over: marks it finished (once, whoever gets there first), reads
   * both players' new ratings, records the result for each player, and has The
   * Arbiter post it in the game's thread, if there is one.
   */
  async finish(gameId: string, now = new Date()): Promise<void> {
    const [g] = await this.db.update(chessGames).set({ finishedAt: now, version: sql`${chessGames.version} + 1` }).where(and(eq(chessGames.id, gameId), isNull(chessGames.finishedAt))).returning()
    if (!g) return
    const { speed } = describeTime(g)
    const accounts = await this.db.select().from(lichessAccounts).where(or(eq(lichessAccounts.memberId, g.whiteId), eq(lichessAccounts.memberId, g.blackId)))
    const before = (memberId: string) => accounts.find((a) => a.memberId === memberId)?.ratings[speed]?.rating ?? null
    let after: Record<string, number | null> = {}
    try {
      const users = await this.lichess.users(accounts.map((a) => a.lichessId))
      for (const u of users) {
        const account = accounts.find((a) => a.lichessId === u.id)
        if (!account) continue
        await this.db.update(lichessAccounts).set({ ratings: u.ratings, ratingsRefreshedAt: now }).where(eq(lichessAccounts.memberId, account.memberId))
        after[account.memberId] = u.ratings[speed]?.rating ?? null
      }
    } catch (err) {
      this.logger.warn(`no new ratings for game ${gameId}: ${(err as Error).message}`)
      after = {}
    }
    const ratingsAfter = {
      white: { before: before(g.whiteId), after: after[g.whiteId] ?? null },
      black: { before: before(g.blackId), after: after[g.blackId] ?? null },
    }
    const played = !['aborted', 'noStart'].includes(g.status)
    await this.db.transaction(async (tx) => {
      await tx.update(chessGames).set({ ratingsAfter }).where(eq(chessGames.id, gameId))
      for (const [side, memberId] of [['white', g.whiteId], ['black', g.blackId]] as const) {
        const outcome = !played ? 'aborted' : g.winner === side ? 'won' : g.winner ? 'lost' : 'drawn'
        await tx.insert(gameEvents).values({
          game: 'chess',
          kind: 'chess_game_finished',
          memberId,
          data: { gameId, side, outcome, status: g.status, rated: g.rated, speed, ratingBefore: ratingsAfter[side].before, ratingAfter: ratingsAfter[side].after },
          createdAt: now,
        })
        if (!played) continue
        // All-time chess stats, kept in game_profiles (docs/games/GAMES.md).
        await tx.execute(sql`
          insert into games.game_profiles (member_id, game, stats, created_at, updated_at)
          values (${memberId}, 'chess', jsonb_build_object('played', 1, ${outcome}::text, 1), ${now}, ${now})
          on conflict (member_id, game) do update set
            stats = games.game_profiles.stats
              || jsonb_build_object('played', coalesce((games.game_profiles.stats->>'played')::int, 0) + 1)
              || jsonb_build_object(${outcome}::text, coalesce((games.game_profiles.stats->>${outcome})::int, 0) + 1),
            updated_at = ${now}`)
      }
      await publishGameChange(tx, gameId)
    })
    if (g.threadPostId) {
      await this.postResult(g, ratingsAfter).catch((err) => this.logger.warn(`no result post for game ${gameId}: ${(err as Error).message}`))
    }
  }

  private async postResult(g: typeof chessGames.$inferSelect, ratings: Record<Side, { before: number | null; after: number | null }>) {
    const names = await this.names(g.whiteId, g.blackId)
    const moves = g.moves ? g.moves.split(' ').length : 0
    const line = resultLine({ status: g.status, winner: g.winner ?? null }, names)
    const change = (side: Side) => {
      const { before, after } = ratings[side]
      return before != null && after != null && before !== after ? `${names[side]} ${before} → ${after}` : null
    }
    const ratingText = g.rated ? [change('white'), change('black')].filter(Boolean).join(', ') : ''
    const text = [
      `${line}${moves ? ` after ${Math.ceil(moves / 2)} moves` : ''}.`,
      ratingText ? `Ratings: ${ratingText}.` : '',
      'Replies from spectators are now visible to both players.',
    ]
      .filter(Boolean)
      .join(' ')
    await this.posts.create(ARBITER_ID, text, {
      replyTo: g.threadPostId!,
      alongside: async (tx, postId) => {
        await tx.update(chessGames).set({ resultPostId: postId }).where(eq(chessGames.id, g.id))
      },
    })
  }
}

