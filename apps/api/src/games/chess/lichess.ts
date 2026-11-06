/**
 * Everything HeyNaija asks Lichess (docs/adr/0018): OAuth with PKCE, the linked
 * account and its ratings, and challenges. Behind an interface so tests and the
 * end-to-end stand-in can replace it; if Lichess's API changes, this file does.
 * Tokens and codes are never logged.
 */

export const LICHESS_SCOPES = ['challenge:read', 'challenge:write', 'board:play'] as const
/** Asked for only when a community moderator wants to run tournaments (phase 6). */
export const TOURNAMENT_SCOPE = 'tournament:write'

/** The four speeds HeyNaija shows. Lichess calls a missing one "not played yet". */
export const RATED_SPEEDS = ['blitz', 'rapid', 'classical', 'correspondence'] as const
export type Ratings = Partial<Record<(typeof RATED_SPEEDS)[number], { rating: number; games: number; provisional: boolean }>>

export type LichessUser = { id: string; username: string; ratings: Ratings }
export type LichessToken = { accessToken: string; expiresAt: Date | null }
export type ChallengeRequest = {
  rated: boolean
  color: 'random' | 'white' | 'black'
} & ({ clockLimit: number; clockIncrement: number } | { days: number })

/** A game's state, from the Board API stream (`gameState`, or the `state` inside `gameFull`). */
export type BoardState = {
  /** Every move so far, in UCI, separated by spaces. */
  moves: string
  /** Milliseconds left on each clock (absent for correspondence). */
  wtime?: number
  btime?: number
  /** 'created' or 'started' while it runs; then how it ended: mate, resign, draw, outoftime, aborted, ... */
  status: string
  winner?: 'white' | 'black'
  /** A draw offer from that side is open. */
  wdraw?: boolean
  bdraw?: boolean
}

export type LichessTeam = { id: string; name: string; nbMembers: number; leaders: string[] }
export type TournamentKind = 'arena' | 'swiss'
export type TournamentRequest = {
  name: string
  /** Seconds, and seconds added a move. */
  clockLimit: number
  clockIncrement: number
  rated: boolean
  startsAt: Date
  teamId: string
} & ({ kind: 'arena'; minutes: number } | { kind: 'swiss'; rounds: number })
export type TournamentState = { status: 'created' | 'started' | 'finished'; nbPlayers: number }
/** One player's result, best first. `score` is Arena points, or Swiss points doubled (half points are whole). */
export type TournamentResult = { rank: number; username: string; score: number }

export type BoardEvent = { type: 'gameFull'; state: BoardState } | ({ type: 'gameState' } & BoardState)

/** Statuses of a game still being played; anything else means it is over. */
export const RUNNING_STATUSES = ['created', 'started'] as const

export type LichessErrorKind =
  /** The token was refused: revoked or expired. The member links again. */
  | 'unauthorized'
  /** Too many requests: wait (a full minute, Lichess asks) and try again. */
  | 'rate_limited'
  /** Lichess did not answer, or answered with an error of its own. */
  | 'unavailable'
  /** Lichess said no to this request (a bad code, a challenge it would not make). */
  | 'rejected'

export class LichessError extends Error {
  constructor(
    readonly kind: LichessErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

export interface LichessApi {
  /** The address to send a member to so they can say yes. */
  authorizeUrl(input: { clientId: string; redirectUri: string; codeChallenge: string; state: string; scopes?: readonly string[] }): string
  token(input: { code: string; codeVerifier: string; redirectUri: string; clientId: string }): Promise<LichessToken>
  revoke(accessToken: string): Promise<void>
  account(accessToken: string): Promise<LichessUser>
  /** Public profiles, at most 300 ids a call; no token needed. Unknown ids are left out. */
  users(ids: string[]): Promise<LichessUser[]>
  /** Challenges `username` with the challenger's token. The returned id is the game's id once accepted. */
  createChallenge(accessToken: string, username: string, request: ChallengeRequest): Promise<{ id: string }>
  acceptChallenge(accessToken: string, challengeId: string): Promise<void>
  cancelChallenge(accessToken: string, challengeId: string): Promise<void>
  /**
   * The Board API's stream of one game, with a player's token: the whole game
   * first, then each change, until the game ends and Lichess closes it. `signal`
   * stops it. No timeout: it is meant to stay open.
   */
  streamGame(accessToken: string, gameId: string, signal: AbortSignal): AsyncIterable<BoardEvent>
  /** A move in UCI (e2e4, e7e8q). Lichess refuses an illegal one ('rejected'). */
  move(accessToken: string, gameId: string, uci: string): Promise<void>
  /** Offers or accepts a draw (yes), or declines one (no). */
  draw(accessToken: string, gameId: string, answer: 'yes' | 'no'): Promise<void>
  resign(accessToken: string, gameId: string): Promise<void>
  /** Only before both players have moved. */
  abort(accessToken: string, gameId: string): Promise<void>
  /** A team's public page: its name, size and publicly listed leaders (lower-case ids). Null if there is no such team. */
  team(teamId: string): Promise<LichessTeam | null>
  /** Makes an Arena (members of the team only) or a Swiss (always the team's) with a leader's token. */
  createTournament(accessToken: string, request: TournamentRequest): Promise<{ id: string }>
  /** Where a tournament is; public, no token. */
  tournament(kind: TournamentKind, id: string): Promise<TournamentState>
  /** Its players best first, at most `max`; public, no token. */
  results(kind: TournamentKind, id: string, max: number): Promise<TournamentResult[]>
  /** Ends it early, with the creator's token. */
  terminate(accessToken: string, kind: TournamentKind, id: string): Promise<void>
}

export const USERS_MAX = 300
const TIMEOUT_MS = 10_000
/** Lichess asks for a full minute after a 429. */
const RATE_LIMIT_WAIT_MS = 60_000

type RawPerf = { rating?: number; games?: number; prov?: boolean }
type RawUser = { id?: string; username?: string; perfs?: Record<string, RawPerf | undefined> }

export function ratingsOf(perfs: RawUser['perfs']): Ratings {
  const out: Ratings = {}
  for (const speed of RATED_SPEEDS) {
    const perf = perfs?.[speed]
    if (perf && typeof perf.rating === 'number') {
      out[speed] = { rating: perf.rating, games: perf.games ?? 0, provisional: Boolean(perf.prov) }
    }
  }
  return out
}

const userOf = (raw: RawUser): LichessUser => {
  if (!raw.id || !raw.username) throw new LichessError('unavailable', 'Lichess sent an account without an id')
  return { id: raw.id.toLowerCase(), username: raw.username, ratings: ratingsOf(raw.perfs) }
}

/** The real client, over HTTPS. `fetchFn` is replaced in tests. */
export class HttpLichess implements LichessApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  authorizeUrl({ clientId, redirectUri, codeChallenge, state, scopes = LICHESS_SCOPES }: Parameters<LichessApi['authorizeUrl']>[0]): string {
    const url = new URL(`${this.baseUrl}/oauth`)
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      scope: scopes.join(' '),
      state,
    }).toString()
    return url.toString()
  }

  async token({ code, codeVerifier, redirectUri, clientId }: Parameters<LichessApi['token']>[0]): Promise<LichessToken> {
    const body = await this.call('POST', '/api/token', {
      form: { grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: clientId },
    })
    const { access_token: accessToken, expires_in: expiresIn } = (body ?? {}) as { access_token?: string; expires_in?: number }
    if (!accessToken) throw new LichessError('unavailable', 'Lichess sent no token')
    return { accessToken, expiresAt: typeof expiresIn === 'number' ? new Date(Date.now() + expiresIn * 1000) : null }
  }

  async revoke(accessToken: string): Promise<void> {
    await this.call('DELETE', '/api/token', { token: accessToken })
  }

  async account(accessToken: string): Promise<LichessUser> {
    return userOf((await this.call('GET', '/api/account', { token: accessToken })) as RawUser)
  }

  async users(ids: string[]): Promise<LichessUser[]> {
    if (!ids.length) return []
    if (ids.length > USERS_MAX) throw new Error(`at most ${USERS_MAX} users a call`)
    const body = await this.call('POST', '/api/users', { text: ids.join(',') })
    return (Array.isArray(body) ? (body as RawUser[]) : []).filter((u) => u.id && u.username).map(userOf)
  }

  async createChallenge(accessToken: string, username: string, request: ChallengeRequest): Promise<{ id: string }> {
    const form: Record<string, string> = { rated: String(request.rated), color: request.color, variant: 'standard' }
    if ('days' in request) form.days = String(request.days)
    else Object.assign(form, { 'clock.limit': String(request.clockLimit), 'clock.increment': String(request.clockIncrement) })
    const body = (await this.call('POST', `/api/challenge/${encodeURIComponent(username)}`, { token: accessToken, form })) as
      | { id?: string; challenge?: { id?: string } }
      | null
    const id = body?.id ?? body?.challenge?.id
    if (!id) throw new LichessError('unavailable', 'Lichess made no challenge')
    return { id }
  }

  async acceptChallenge(accessToken: string, challengeId: string): Promise<void> {
    await this.call('POST', `/api/challenge/${encodeURIComponent(challengeId)}/accept`, { token: accessToken })
  }

  async cancelChallenge(accessToken: string, challengeId: string): Promise<void> {
    await this.call('POST', `/api/challenge/${encodeURIComponent(challengeId)}/cancel`, { token: accessToken })
  }

  async *streamGame(accessToken: string, gameId: string, signal: AbortSignal): AsyncIterable<BoardEvent> {
    const path = `/api/board/game/stream/${encodeURIComponent(gameId)}`
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        headers: { accept: 'application/x-ndjson', authorization: `Bearer ${accessToken}` },
        redirect: 'error',
        signal,
      })
    } catch {
      throw new LichessError('unavailable', `Lichess did not answer GET ${path}`)
    }
    this.check(res, path)
    if (!res.body) return
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          newline = buffer.indexOf('\n')
          // Lichess sends an empty line every few seconds to keep the connection open.
          if (!line) continue
          const event = parseBoardEvent(line)
          if (event) yield event
        }
      }
    } catch (err) {
      if (signal.aborted) return
      throw new LichessError('unavailable', `the stream of ${path} broke off: ${(err as Error).message}`)
    }
  }

  async move(accessToken: string, gameId: string, uci: string): Promise<void> {
    await this.call('POST', `/api/board/game/${encodeURIComponent(gameId)}/move/${encodeURIComponent(uci)}`, { token: accessToken })
  }

  async draw(accessToken: string, gameId: string, answer: 'yes' | 'no'): Promise<void> {
    await this.call('POST', `/api/board/game/${encodeURIComponent(gameId)}/draw/${answer}`, { token: accessToken })
  }

  async resign(accessToken: string, gameId: string): Promise<void> {
    await this.call('POST', `/api/board/game/${encodeURIComponent(gameId)}/resign`, { token: accessToken })
  }

  async abort(accessToken: string, gameId: string): Promise<void> {
    await this.call('POST', `/api/board/game/${encodeURIComponent(gameId)}/abort`, { token: accessToken })
  }

  async team(teamId: string): Promise<LichessTeam | null> {
    let body: unknown
    try {
      body = await this.call('GET', `/api/team/${encodeURIComponent(teamId)}`)
    } catch (err) {
      if (err instanceof LichessError && err.kind === 'rejected') return null
      throw err
    }
    const raw = (body ?? {}) as { id?: string; name?: string; nbMembers?: number; leaders?: { id?: string }[]; leader?: { id?: string } }
    if (!raw.id || !raw.name) return null
    const leaders = [...(raw.leaders ?? []), ...(raw.leader ? [raw.leader] : [])].map((l) => l.id?.toLowerCase()).filter((id): id is string => Boolean(id))
    return { id: raw.id, name: raw.name, nbMembers: typeof raw.nbMembers === 'number' ? raw.nbMembers : 0, leaders: [...new Set(leaders)] }
  }

  async createTournament(accessToken: string, r: TournamentRequest): Promise<{ id: string }> {
    const common = { name: r.name, rated: String(r.rated), variant: 'standard' }
    const body =
      r.kind === 'arena'
        ? await this.call('POST', '/api/tournament', {
            token: accessToken,
            form: {
              ...common,
              // Arena clocks are in minutes there.
              clockTime: String(r.clockLimit / 60),
              clockIncrement: String(r.clockIncrement),
              minutes: String(r.minutes),
              startDate: String(r.startsAt.getTime()),
              'conditions.teamMember.teamId': r.teamId,
            },
          })
        : await this.call('POST', `/api/swiss/new/${encodeURIComponent(r.teamId)}`, {
            token: accessToken,
            form: {
              ...common,
              'clock.limit': String(r.clockLimit),
              'clock.increment': String(r.clockIncrement),
              nbRounds: String(r.rounds),
              startsAt: String(r.startsAt.getTime()),
            },
          })
    const id = (body as { id?: string } | null)?.id
    if (!id) throw new LichessError('unavailable', 'Lichess made no tournament')
    return { id }
  }

  async tournament(kind: TournamentKind, id: string): Promise<TournamentState> {
    const raw = ((await this.call('GET', `/api/${kind === 'arena' ? 'tournament' : 'swiss'}/${encodeURIComponent(id)}`)) ?? {}) as {
      isFinished?: boolean
      secondsToStart?: number
      status?: string
      nbPlayers?: number
    }
    const nbPlayers = typeof raw.nbPlayers === 'number' ? raw.nbPlayers : 0
    if (kind === 'swiss') {
      const status = raw.status === 'finished' || raw.status === 'started' ? raw.status : 'created'
      return { status, nbPlayers }
    }
    return { status: raw.isFinished ? 'finished' : (raw.secondsToStart ?? 0) > 0 ? 'created' : 'started', nbPlayers }
  }

  async results(kind: TournamentKind, id: string, max: number): Promise<TournamentResult[]> {
    const path = `/api/${kind === 'arena' ? 'tournament' : 'swiss'}/${encodeURIComponent(id)}/results?nb=${max}`
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { headers: { accept: 'application/x-ndjson' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new LichessError('unavailable', `Lichess did not answer GET ${path}`)
    }
    this.check(res, path)
    return parseResults(kind, await res.text())
  }

  async terminate(accessToken: string, kind: TournamentKind, id: string): Promise<void> {
    await this.call('POST', `/api/${kind === 'arena' ? 'tournament' : 'swiss'}/${encodeURIComponent(id)}/terminate`, { token: accessToken })
  }

  /** Turns an answer that is not a success into a LichessError. */
  private check(res: Response, path: string) {
    if (res.status === 401 || res.status === 403) throw new LichessError('unauthorized', `Lichess refused the token for ${path}`)
    if (res.status === 429) throw new LichessError('rate_limited', 'Lichess asked us to slow down', RATE_LIMIT_WAIT_MS)
    if (res.status >= 500) throw new LichessError('unavailable', `Lichess answered ${res.status} for ${path}`)
    if (!res.ok) throw new LichessError('rejected', `Lichess said no (${res.status}) to ${path}`)
  }

  private async call(
    method: string,
    path: string,
    { token, form, text }: { token?: string; form?: Record<string, string>; text?: string } = {},
  ): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    let body: string | undefined
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(form).toString()
    } else if (text !== undefined) {
      headers['content-type'] = 'text/plain'
      body = text
    }
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      // The path only; never the token or the code.
      throw new LichessError('unavailable', `Lichess did not answer ${method} ${path}`)
    }
    this.check(res, path)
    if (res.status === 204) return null
    const raw = await res.text()
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      throw new LichessError('unavailable', `Lichess sent something that is not JSON for ${path}`)
    }
  }
}

/** One line of the Board API stream, or null for one this code does not use (chat, opponentGone). */
export function parseBoardEvent(line: string): BoardEvent | null {
  let raw: { type?: string; state?: Partial<BoardState> } & Partial<BoardState>
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const state = (s: Partial<BoardState> | undefined): BoardState | null =>
    s && typeof s.moves === 'string' && typeof s.status === 'string'
      ? {
          moves: s.moves,
          status: s.status,
          ...(typeof s.wtime === 'number' ? { wtime: s.wtime } : {}),
          ...(typeof s.btime === 'number' ? { btime: s.btime } : {}),
          ...(s.winner === 'white' || s.winner === 'black' ? { winner: s.winner } : {}),
          wdraw: Boolean(s.wdraw),
          bdraw: Boolean(s.bdraw),
        }
      : null
  if (raw.type === 'gameFull') {
    const s = state(raw.state)
    return s ? { type: 'gameFull', state: s } : null
  }
  if (raw.type === 'gameState') {
    const s = state(raw)
    return s ? { type: 'gameState', ...s } : null
  }
  return null
}

/** A tournament's ndjson results: Arena `score`, or Swiss `points` doubled so half points stay whole. Lines it cannot read are skipped. */
export function parseResults(kind: TournamentKind, ndjson: string): TournamentResult[] {
  const out: TournamentResult[] = []
  for (const line of ndjson.split('\n')) {
    if (!line.trim()) continue
    let raw: { rank?: unknown; username?: unknown; score?: unknown; points?: unknown }
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    const points = kind === 'arena' ? raw.score : typeof raw.points === 'number' ? raw.points * 2 : undefined
    if (typeof raw.rank !== 'number' || typeof raw.username !== 'string' || typeof points !== 'number') continue
    out.push({ rank: raw.rank, username: raw.username, score: Math.round(points) })
  }
  return out.sort((a, b) => a.rank - b.rank)
}
