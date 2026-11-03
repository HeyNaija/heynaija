import { createHash, randomBytes } from 'node:crypto'
import { chessChallenges, type Db, lichessAccounts, lichessLinkAttempts, members } from '@heynaija/db'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Env } from '../../env.js'
import { FeatureFlags } from '../../flags/feature-flags.js'
import { avatarPath } from '../../media/media.service.js'
import { notify } from '../../notifications/notifications.service.js'
import { blockedEitherWay } from '../../posts/posts.service.js'
import { DB, ENV } from '../../tokens.js'
import type { TokenBox } from '../core/token-box.js'
import { type ChallengeRequest, LichessError, type LichessApi, type Ratings, USERS_MAX } from './lichess.js'
import { describeTime, TIME_CONTROLS, timeControlById } from './time-controls.js'

export const LICHESS = Symbol('LICHESS')
/** The TokenBox for GAMES_TOKEN_KEY, or null when no key is set and linking is not available. */
export const TOKEN_BOX = Symbol('TOKEN_BOX')

/** How long a linking step may take, from leaving for Lichess to coming back. */
export const LINK_ATTEMPT_MS = 10 * 60_000
/** How long a challenge waits for an answer: a day for a clock game, a week for correspondence. */
export const CHALLENGE_WAIT_MS = { clock: 24 * 3600_000, correspondence: 7 * 24 * 3600_000 }
/** Ratings older than this are read again by the scheduled job. */
export const RATINGS_STALE_MS = 6 * 3600_000
/** How far back "recent" challenges go on the chess page. */
const RECENT_MAX = 10

export type ChessErrorCode =
  | 'not_available'
  | 'not_linked'
  | 'opponent_not_linked'
  | 'not_found'
  | 'invalid'
  | 'self'
  | 'duplicate'
  | 'link_expired'
  | 'already_linked'
  | 'reconnect'
  | 'lichess_busy'
  | 'lichess_unavailable'
  | 'lichess_rejected'

export class ChessError extends Error {
  constructor(
    readonly code: ChessErrorCode,
    message: string,
  ) {
    super(message)
  }
}

type Person = { handle: string; displayName: string | null; avatar: string | null }
export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'failed' | 'expired'
export type ChallengeView = {
  id: string
  /** The other member, from the viewer's side. */
  opponent: Person
  /** Whether the viewer sent it. */
  sent: boolean
  rated: boolean
  speed: string
  time: string
  /** The colour the viewer plays: random, white or black. */
  color: 'random' | 'white' | 'black'
  status: ChallengeStatus
  createdAt: Date
  expiresAt: Date
  /** Once accepted: where the game is played. */
  gameUrl: string | null
}

export type LinkedAccount = { username: string; ratings: Ratings; ratingsRefreshedAt: Date | null; linkedAt: Date; url: string }

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const flipColor = (c: 'random' | 'white' | 'black') => (c === 'white' ? 'black' : c === 'black' ? 'white' : 'random')

/**
 * Chess on Lichess (docs/adr/0018, docs/games/GAMES.md): linking an account with
 * OAuth and PKCE, its ratings, and challenges between members who have both
 * linked one. A challenge lives here until it is accepted; then the game is made
 * on Lichess with both members' tokens, so nothing waits on Lichess's side.
 */
@Injectable()
export class ChessService {
  private readonly logger = new Logger('Chess')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_PUBLIC_URL' | 'LICHESS_URL'>,
    @Inject(LICHESS) private readonly lichess: LichessApi,
    @Inject(TOKEN_BOX) private readonly box: TokenBox | null,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'isEnabled'>,
  ) {}

  /** Lichess knows HeyNaija by its address: heynaija.ng in production. */
  private get clientId() {
    return new URL(this.env.WEB_PUBLIC_URL).host
  }

  private get redirectUri() {
    return `${this.env.WEB_PUBLIC_URL}/games/chess/callback`
  }

  private gameUrl(id: string) {
    return `${this.env.LICHESS_URL}/${id}`
  }

  private sealer(): TokenBox {
    if (!this.box) throw new ChessError('not_available', 'Linking a Lichess account is not available here yet')
    return this.box
  }

  // --- Linking ----------------------------------------------------------------

  /** Starts linking: remembers a single-use state and verifier, and returns where to send the member. */
  async startLink(memberId: string, now = new Date()): Promise<{ url: string }> {
    const box = this.sealer()
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    await this.db.transaction(async (tx) => {
      // Only the latest attempt counts; older ones and any that ran out go.
      await tx.delete(lichessLinkAttempts).where(or(eq(lichessLinkAttempts.memberId, memberId), lt(lichessLinkAttempts.expiresAt, now)))
      await tx.insert(lichessLinkAttempts).values({
        stateHash: sha256(state),
        memberId,
        verifierBox: box.seal(verifier, memberId),
        expiresAt: new Date(now.getTime() + LINK_ATTEMPT_MS),
      })
    })
    return { url: this.lichess.authorizeUrl({ clientId: this.clientId, redirectUri: this.redirectUri, codeChallenge: challenge, state }) }
  }

  /**
   * Finishes linking, with what Lichess sent back. The attempt is used up whatever
   * happens, so a replayed address does nothing; it must be this member's and
   * within ten minutes.
   */
  async completeLink(memberId: string, code: string, state: string, now = new Date()): Promise<LinkedAccount> {
    const box = this.sealer()
    const [attempt] = await this.db.delete(lichessLinkAttempts).where(eq(lichessLinkAttempts.stateHash, sha256(state))).returning()
    if (!attempt || attempt.memberId !== memberId || attempt.expiresAt <= now) {
      throw new ChessError('link_expired', 'That link to Lichess has run out or was not yours. Start again.')
    }
    const verifier = box.open(attempt.verifierBox, memberId)
    const token = await this.ask(() => this.lichess.token({ code, codeVerifier: verifier, redirectUri: this.redirectUri, clientId: this.clientId }))
    const user = await this.ask(() => this.lichess.account(token.accessToken))

    const linked = await this.db.transaction(async (tx) => {
      await this.lockMembers(tx, [memberId])
      const [taken] = await tx
        .select({ memberId: lichessAccounts.memberId })
        .from(lichessAccounts)
        .where(and(eq(lichessAccounts.lichessId, user.id), sql`${lichessAccounts.memberId} <> ${memberId}`))
      if (taken) return null
      const row = {
        lichessId: user.id,
        username: user.username,
        tokenBox: box.seal(token.accessToken, memberId),
        tokenExpiresAt: token.expiresAt,
        scopes: 'challenge:read challenge:write board:play',
        ratings: user.ratings,
        ratingsRefreshedAt: now,
      }
      const [saved] = await tx
        .insert(lichessAccounts)
        .values({ memberId, ...row, linkedAt: now })
        .onConflictDoUpdate({ target: lichessAccounts.memberId, set: { ...row, linkedAt: now } })
        .returning()
      return saved!
    })
    if (!linked) {
      // The token is ours to give back; the other member keeps theirs.
      await this.lichess.revoke(token.accessToken).catch(() => undefined)
      throw new ChessError('already_linked', 'That Lichess account is already linked to another HeyNaija member.')
    }
    return this.linkedView(linked)
  }

  /** Unlinks: gives the token back to Lichess if it can, and forgets it either way. */
  async unlink(memberId: string): Promise<void> {
    const [account] = await this.db.select().from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
    if (!account) return
    await this.revokeQuietly(account.tokenBox, memberId)
    await this.db.delete(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
    await this.db.delete(lichessLinkAttempts).where(eq(lichessLinkAttempts.memberId, memberId))
  }

  /** Before an account is erased (GamesEraser): its token goes back to Lichess if it can. The rows are deleted by the erase. */
  async revokeFor(memberId: string): Promise<void> {
    const [account] = await this.db.select({ tokenBox: lichessAccounts.tokenBox }).from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
    if (account && this.box) await this.revokeQuietly(account.tokenBox, memberId)
  }

  /** Tries to revoke a sealed token at Lichess; failing to (Lichess down, key changed) never stops the caller. */
  async revokeQuietly(tokenBox: string, memberId: string): Promise<void> {
    try {
      await this.lichess.revoke(this.sealer().open(tokenBox, memberId))
    } catch (err) {
      this.logger.warn(`could not revoke a Lichess token for member ${memberId}: ${(err as Error).message}`)
    }
  }

  // --- Ratings ----------------------------------------------------------------

  /** Reads the member's ratings from Lichess now. */
  async refreshMine(memberId: string, now = new Date()): Promise<LinkedAccount> {
    const [account] = await this.db.select().from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
    if (!account) throw new ChessError('not_linked', 'Link your Lichess account first.')
    const [user] = await this.ask(() => this.lichess.users([account.lichessId]))
    const [saved] = await this.db
      .update(lichessAccounts)
      .set({ ratings: user?.ratings ?? account.ratings, username: user?.username ?? account.username, ratingsRefreshedAt: now })
      .where(eq(lichessAccounts.memberId, memberId))
      .returning()
    return this.linkedView(saved!)
  }

  /**
   * The scheduled refresh: the accounts read longest ago, up to one Lichess call's
   * worth. Lichess slowing us down ends the run; the next one carries on.
   * Returns how many were brought up to date.
   */
  async refreshDue(now = new Date()): Promise<number> {
    const due = await this.db
      .select({ memberId: lichessAccounts.memberId, lichessId: lichessAccounts.lichessId })
      .from(lichessAccounts)
      .where(or(isNull(lichessAccounts.ratingsRefreshedAt), lt(lichessAccounts.ratingsRefreshedAt, new Date(now.getTime() - RATINGS_STALE_MS))))
      .orderBy(sql`${lichessAccounts.ratingsRefreshedAt} asc nulls first`)
      .limit(USERS_MAX)
    if (!due.length) return 0
    let users
    try {
      users = await this.lichess.users(due.map((d) => d.lichessId))
    } catch (err) {
      if (err instanceof LichessError) {
        this.logger.warn(`ratings refresh stopped: ${err.message}`)
        return 0
      }
      throw err
    }
    const byId = new Map(users.map((u) => [u.id, u]))
    for (const { memberId, lichessId } of due) {
      const user = byId.get(lichessId)
      // An account Lichess no longer has keeps its last ratings; it is not asked about again until it goes stale.
      await this.db
        .update(lichessAccounts)
        .set(user ? { ratings: user.ratings, username: user.username, ratingsRefreshedAt: now } : { ratingsRefreshedAt: now })
        .where(eq(lichessAccounts.memberId, memberId))
    }
    return byId.size
  }

  // --- Reading ----------------------------------------------------------------

  /** What the chess page shows the member. */
  async overview(memberId: string, now = new Date()) {
    const [account] = await this.db.select().from(lichessAccounts).where(eq(lichessAccounts.memberId, memberId))
    const challenges = await this.challengesOf(memberId, now)
    return {
      linkingAvailable: this.box !== null,
      account: account ? this.linkedView(account) : null,
      timeControls: TIME_CONTROLS,
      incoming: challenges.filter((c) => !c.sent && c.status === 'pending'),
      outgoing: challenges.filter((c) => c.sent && c.status === 'pending'),
      recent: challenges.filter((c) => c.status !== 'pending').slice(0, RECENT_MAX),
    }
  }

  /** Another member's Lichess account as a profile shows it; null if they have none or the viewer may not see them. */
  async memberAccount(viewerId: string, handle: string): Promise<{ username: string; ratings: Ratings; url: string; canChallenge: boolean } | null> {
    const { rows } = await this.db.execute<{ id: string; username: string; ratings: Ratings; viewer_linked: boolean }>(sql`
      select m.id, la.username, la.ratings,
        exists(select 1 from games.lichess_accounts mine where mine.member_id = ${viewerId}) as viewer_linked
      from members m join games.lichess_accounts la on la.member_id = m.id
      where m.handle = ${handle.toLowerCase()} and m.active and not ${blockedEitherWay(sql`m.id`, viewerId)}`)
    const row = rows[0]
    if (!row) return null
    return {
      username: row.username,
      ratings: row.ratings,
      url: `${this.env.LICHESS_URL}/@/${row.username}`,
      canChallenge: row.id !== viewerId && row.viewer_linked && (await this.flags.isEnabled('games', row.id)),
    }
  }

  /** Members the viewer could challenge, for the picker: linked, active, not blocked either way, handle or name starting with `query`. */
  async opponents(viewerId: string, query: string): Promise<(Person & { lichess: string })[]> {
    const q = query.trim().replace(/^@/, '').toLowerCase()
    if (!/^[a-z0-9_ ]{1,30}$/.test(q)) return []
    const starts = `${q.replace(/_/g, '\\_')}%`
    const { rows } = await this.db.execute<{ id: string; handle: string; display_name: string | null; avatar_media_id: string | null; username: string }>(sql`
      select m.id, m.handle, m.display_name, m.avatar_media_id, la.username
      from members m join games.lichess_accounts la on la.member_id = m.id
      where m.active and m.id <> ${viewerId} and not ${blockedEitherWay(sql`m.id`, viewerId)}
        and (m.handle like ${starts} or lower(m.display_name) like ${starts} or lower(m.display_name) like ${`% ${starts}`})
      order by m.handle limit 8`)
    const out = []
    for (const r of rows) {
      if (!(await this.flags.isEnabled('games', r.id))) continue
      out.push({ handle: r.handle, displayName: r.display_name, avatar: avatarPath(r.avatar_media_id), lichess: r.username })
    }
    return out
  }

  // --- Challenges -------------------------------------------------------------

  /** Challenges `handle`. Both must have linked Lichess and have Games; neither may block the other. */
  async challenge(
    memberId: string,
    input: { handle: string; rated: boolean; timeControl: string; color: 'random' | 'white' | 'black' },
    now = new Date(),
  ): Promise<ChallengeView> {
    const tc = timeControlById(input.timeControl)
    if (!tc) throw new ChessError('invalid', 'Choose one of the time controls offered.')
    const [target] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.handle, input.handle.replace(/^@/, '').toLowerCase()), eq(members.active, true)))
    if (!target) throw new ChessError('not_found', 'There is no member with that handle.')
    if (target.id === memberId) throw new ChessError('self', 'You cannot challenge yourself.')

    const id = await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ mine: boolean; theirs: boolean; blocked: boolean }>(sql`
        select exists(select 1 from games.lichess_accounts where member_id = ${memberId}) as mine,
          exists(select 1 from games.lichess_accounts where member_id = ${target.id}) as theirs,
          ${blockedEitherWay(memberId, target.id)} as blocked`)
      const facts = rows[0]!
      if (!facts.mine) throw new ChessError('not_linked', 'Link your Lichess account first.')
      // Blocked, or without Games: the same answer as not having linked, so a challenge tells nobody anything.
      if (!facts.theirs || facts.blocked || !(await this.flags.isEnabled('games', target.id))) {
        throw new ChessError('opponent_not_linked', 'You can only challenge members who have linked a Lichess account.')
      }
      const time = 'days' in tc ? { clockLimit: null, clockIncrement: null, days: tc.days } : { clockLimit: tc.limit, clockIncrement: tc.increment, days: null }
      const wait = 'days' in tc ? CHALLENGE_WAIT_MS.correspondence : CHALLENGE_WAIT_MS.clock
      // An open challenge to the same member that has run out makes way for this one.
      await tx
        .update(chessChallenges)
        .set({ status: 'cancelled', respondedAt: now })
        .where(and(eq(chessChallenges.challengerId, memberId), eq(chessChallenges.challengedId, target.id), eq(chessChallenges.status, 'pending'), lt(chessChallenges.expiresAt, now)))
      const [made] = await tx
        .insert(chessChallenges)
        .values({ challengerId: memberId, challengedId: target.id, rated: input.rated, color: input.color, ...time, createdAt: now, expiresAt: new Date(now.getTime() + wait) })
        .onConflictDoNothing()
        .returning({ id: chessChallenges.id })
      if (!made) throw new ChessError('duplicate', 'You have already challenged them; wait for their answer.')
      await notify(tx, [{ recipientId: target.id, kind: 'chess_challenge', actorId: memberId, challengeId: made.id }])
      return made.id
    })
    return (await this.challengesOf(memberId, now, id))[0]!
  }

  /**
   * Accepts a challenge sent to the member: makes the game on Lichess with the
   * challenger's token and accepts it at once with the member's. If accepting
   * fails the Lichess challenge is withdrawn and this one stays open.
   */
  async accept(memberId: string, challengeId: string, now = new Date()): Promise<ChallengeView> {
    const box = this.sealer()
    await this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(chessChallenges).where(eq(chessChallenges.id, challengeId)).for('update')
      if (!c || c.challengedId !== memberId) throw new ChessError('not_found', 'That challenge is not there any more.')
      if (c.status !== 'pending' || c.expiresAt <= now) throw new ChessError('not_found', 'That challenge is no longer open.')
      await this.lockMembers(tx, [c.challengerId, c.challengedId])
      const accounts = await tx.select().from(lichessAccounts).where(or(eq(lichessAccounts.memberId, c.challengerId), eq(lichessAccounts.memberId, c.challengedId)))
      const theirs = accounts.find((a) => a.memberId === c.challengerId)
      const mine = accounts.find((a) => a.memberId === memberId)
      if (!mine) throw new ChessError('not_linked', 'Link your Lichess account first.')
      if (!theirs) {
        await tx.update(chessChallenges).set({ status: 'failed', respondedAt: now }).where(eq(chessChallenges.id, c.id))
        return
      }
      const request: ChallengeRequest =
        c.days != null ? { rated: c.rated, color: c.color, days: c.days } : { rated: c.rated, color: c.color, clockLimit: c.clockLimit!, clockIncrement: c.clockIncrement! }
      let gameId: string
      try {
        ;({ id: gameId } = await this.lichess.createChallenge(box.open(theirs.tokenBox, theirs.memberId), mine.username, request))
      } catch (err) {
        // The challenger's token no longer works: they must link again, and this challenge cannot be played.
        if (err instanceof LichessError && err.kind === 'unauthorized') {
          await tx.update(chessChallenges).set({ status: 'failed', respondedAt: now }).where(eq(chessChallenges.id, c.id))
          return
        }
        throw this.translate(err)
      }
      try {
        await this.lichess.acceptChallenge(box.open(mine.tokenBox, memberId), gameId)
      } catch (err) {
        await this.lichess.cancelChallenge(box.open(theirs.tokenBox, theirs.memberId), gameId).catch(() => undefined)
        if (err instanceof LichessError && err.kind === 'unauthorized') {
          throw new ChessError('reconnect', 'Lichess no longer accepts your link. Disconnect and connect Lichess again.')
        }
        throw this.translate(err)
      }
      await tx.update(chessChallenges).set({ status: 'accepted', lichessGameId: gameId, respondedAt: now }).where(eq(chessChallenges.id, c.id))
    })
    const [view] = await this.challengesOf(memberId, now, challengeId)
    if (view?.status === 'failed') throw new ChessError('lichess_rejected', 'Their Lichess link no longer works, so this game cannot be made. They can link again and challenge you anew.')
    return view!
  }

  async decline(memberId: string, challengeId: string, now = new Date()): Promise<void> {
    await this.settle(memberId, challengeId, 'challenged', 'declined', now)
  }

  async cancel(memberId: string, challengeId: string, now = new Date()): Promise<void> {
    await this.settle(memberId, challengeId, 'challenger', 'cancelled', now)
  }

  private async settle(memberId: string, challengeId: string, side: 'challenger' | 'challenged', status: 'declined' | 'cancelled', now: Date) {
    const who = side === 'challenger' ? chessChallenges.challengerId : chessChallenges.challengedId
    const [done] = await this.db
      .update(chessChallenges)
      .set({ status, respondedAt: now })
      .where(and(eq(chessChallenges.id, challengeId), eq(who, memberId), eq(chessChallenges.status, 'pending')))
      .returning({ id: chessChallenges.id })
    if (!done) throw new ChessError('not_found', 'That challenge is no longer open.')
  }

  // --- Helpers ----------------------------------------------------------------

  /** One Lichess request at a time per member (GAMES.md): holds each member's lock for the transaction, in a fixed order. */
  private async lockMembers(tx: Pick<Db, 'execute'>, ids: string[]) {
    for (const id of [...new Set(ids)].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`lichess/${id}`}, 0))`)
    }
  }

  /** Runs a Lichess call, turning its errors into ones the member can act on. */
  private async ask<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call()
    } catch (err) {
      throw this.translate(err)
    }
  }

  private translate(err: unknown): Error {
    if (!(err instanceof LichessError)) return err as Error
    switch (err.kind) {
      case 'unauthorized':
        return new ChessError('reconnect', 'Lichess no longer accepts your link. Disconnect and connect Lichess again.')
      case 'rate_limited':
        return new ChessError('lichess_busy', 'Lichess is busy. Try again in a minute.')
      case 'rejected':
        return new ChessError('lichess_rejected', 'Lichess would not do that. Try again, or start over.')
      case 'unavailable':
        return new ChessError('lichess_unavailable', 'Lichess did not answer. Try again in a moment.')
    }
  }

  private linkedView(a: typeof lichessAccounts.$inferSelect): LinkedAccount {
    return { username: a.username, ratings: a.ratings, ratingsRefreshedAt: a.ratingsRefreshedAt, linkedAt: a.linkedAt, url: `${this.env.LICHESS_URL}/@/${a.username}` }
  }

  /** The member's challenges, newest first, or just `onlyId`. */
  private async challengesOf(memberId: string, now: Date, onlyId?: string): Promise<ChallengeView[]> {
    const { rows } = await this.db.execute<{
      id: string
      challenger_id: string
      rated: boolean
      clock_limit: number | null
      clock_increment: number | null
      days: number | null
      color: 'random' | 'white' | 'black'
      status: Exclude<ChallengeStatus, 'expired'>
      lichess_game_id: string | null
      created_at: Date
      expires_at: Date
      handle: string
      display_name: string | null
      avatar_media_id: string | null
    }>(sql`
      select c.id, c.challenger_id, c.rated, c.clock_limit, c.clock_increment, c.days, c.color, c.status,
        c.lichess_game_id, c.created_at, c.expires_at, o.handle, o.display_name, o.avatar_media_id
      from games.chess_challenges c
      join members o on o.id = case when c.challenger_id = ${memberId} then c.challenged_id else c.challenger_id end
      where (c.challenger_id = ${memberId} or c.challenged_id = ${memberId})
        and ${onlyId ? sql`c.id = ${onlyId}` : sql`(c.status = 'pending' or c.created_at > ${new Date(now.getTime() - 30 * 24 * 3600_000).toISOString()}::timestamptz)`}
        and o.active and not ${blockedEitherWay(sql`o.id`, memberId)}
      order by c.created_at desc, c.id desc
      limit 100`)
    return rows.map((r) => {
      const sent = r.challenger_id === memberId
      const { speed, label } = describeTime({ clockLimit: r.clock_limit, clockIncrement: r.clock_increment, days: r.days })
      const expired = r.status === 'pending' && new Date(r.expires_at) <= now
      return {
        id: r.id,
        opponent: { handle: r.handle, displayName: r.display_name, avatar: avatarPath(r.avatar_media_id) },
        sent,
        rated: r.rated,
        speed,
        time: label,
        // Lichess's colour is the challenger's; the challenged member plays the other one.
        color: sent ? r.color : flipColor(r.color),
        status: expired ? 'expired' : r.status,
        createdAt: new Date(r.created_at),
        expiresAt: new Date(r.expires_at),
        gameUrl: r.lichess_game_id ? this.gameUrl(r.lichess_game_id) : null,
      }
    })
  }
}

