// For tests only: a stand-in for Lichess that records every call and lets a test
// play out a game's Board API stream event by event.
import {
  type BoardEvent,
  type ChallengeRequest,
  LichessError,
  type LichessApi,
  type LichessTeam,
  type LichessUser,
  type TournamentKind,
  type TournamentRequest,
  type TournamentResult,
  type TournamentState,
} from './lichess.js'

type Stream = { events: (BoardEvent | null)[]; wake?: () => void }

export class FakeLichess implements LichessApi {
  calls: string[] = []
  accounts = new Map<string, LichessUser>()
  fail: Partial<
    Record<'token' | 'revoke' | 'users' | 'create' | 'accept' | 'move' | 'draw' | 'resign' | 'abort' | 'stream' | 'team' | 'tournament' | 'results' | 'terminate', LichessError>
  > = {}
  /** Teams by id, and each tournament's state and results, as a test sets them. */
  teams = new Map<string, LichessTeam>()
  tournaments = new Map<string, TournamentState & { kind: TournamentKind; results: TournamentResult[]; request: TournamentRequest }>()
  next = 1
  private readonly streams = new Map<string, Stream>()

  /** Lichess-shaped game ids: eight characters. */
  gameId(n: number) {
    return `gm${String(n).padStart(6, '0')}`
  }

  authorizeUrl({ clientId, redirectUri, codeChallenge, state, scopes = ['challenge:read', 'challenge:write', 'board:play'] }: Parameters<LichessApi['authorizeUrl']>[0]) {
    return `https://lichess.test/oauth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state, scope: scopes.join(' ') })}`
  }
  async token({ code }: { code: string }) {
    this.calls.push(`token:${code}`)
    if (this.fail.token) throw this.fail.token
    return { accessToken: `tok-${code}`, expiresAt: null }
  }
  async revoke(token: string) {
    this.calls.push(`revoke:${token}`)
    if (this.fail.revoke) throw this.fail.revoke
  }
  async account(token: string) {
    const user = this.accounts.get(token)
    if (!user) throw new LichessError('unauthorized', 'no')
    return user
  }
  async users(ids: string[]) {
    this.calls.push(`users:${ids.join(',')}`)
    if (this.fail.users) throw this.fail.users
    return ids.map((id) => ({ id, username: id.toUpperCase(), ratings: { blitz: { rating: 1600, games: 10, provisional: false } } }))
  }
  async createChallenge(token: string, username: string, request: ChallengeRequest) {
    this.calls.push(`create:${token}->${username}:${JSON.stringify(request)}`)
    if (this.fail.create) throw this.fail.create
    return { id: this.gameId(this.next++) }
  }
  async acceptChallenge(token: string, id: string) {
    this.calls.push(`accept:${token}:${id}`)
    if (this.fail.accept) throw this.fail.accept
  }
  async cancelChallenge(token: string, id: string) {
    this.calls.push(`cancel:${token}:${id}`)
  }
  async move(token: string, id: string, uci: string) {
    this.calls.push(`move:${token}:${id}:${uci}`)
    if (this.fail.move) throw this.fail.move
  }
  async draw(token: string, id: string, answer: 'yes' | 'no') {
    this.calls.push(`draw:${token}:${id}:${answer}`)
    if (this.fail.draw) throw this.fail.draw
  }
  async resign(token: string, id: string) {
    this.calls.push(`resign:${token}:${id}`)
    if (this.fail.resign) throw this.fail.resign
  }
  async abort(token: string, id: string) {
    this.calls.push(`abort:${token}:${id}`)
    if (this.fail.abort) throw this.fail.abort
  }

  async team(id: string) {
    this.calls.push(`team:${id}`)
    if (this.fail.team) throw this.fail.team
    return this.teams.get(id) ?? null
  }
  async createTournament(token: string, request: TournamentRequest) {
    this.calls.push(`tournament:${token}:${JSON.stringify(request)}`)
    if (this.fail.create) throw this.fail.create
    const id = `tn${String(this.next++).padStart(6, '0')}`
    this.tournaments.set(id, { kind: request.kind, status: 'created', nbPlayers: 0, results: [], request })
    return { id }
  }
  async tournament(kind: TournamentKind, id: string) {
    this.calls.push(`state:${kind}:${id}`)
    if (this.fail.tournament) throw this.fail.tournament
    const t = this.tournaments.get(id)
    if (!t) throw new LichessError('rejected', 'no such tournament')
    return { status: t.status, nbPlayers: t.nbPlayers }
  }
  async results(kind: TournamentKind, id: string, max: number) {
    this.calls.push(`results:${kind}:${id}`)
    if (this.fail.results) throw this.fail.results
    return (this.tournaments.get(id)?.results ?? []).slice(0, max)
  }
  async terminate(token: string, kind: TournamentKind, id: string) {
    this.calls.push(`terminate:${token}:${kind}:${id}`)
    if (this.fail.terminate) throw this.fail.terminate
    const t = this.tournaments.get(id)
    if (t) t.status = 'finished'
  }

  /** Queues an event on a game's stream; `null` ends the stream (as Lichess closing it). */
  push(gameId: string, event: BoardEvent | null) {
    const stream = this.streamOf(gameId)
    stream.events.push(event)
    stream.wake?.()
  }

  async *streamGame(token: string, gameId: string, signal: AbortSignal): AsyncIterable<BoardEvent> {
    this.calls.push(`stream:${token}:${gameId}`)
    if (this.fail.stream) throw this.fail.stream
    const stream = this.streamOf(gameId)
    while (!signal.aborted) {
      const event = stream.events.shift()
      if (event === null) return
      if (event) {
        yield event
        continue
      }
      await new Promise<void>((done) => {
        stream.wake = done
        signal.addEventListener('abort', () => done())
      })
      stream.wake = undefined
    }
  }

  private streamOf(gameId: string): Stream {
    const stream = this.streams.get(gameId) ?? { events: [] }
    this.streams.set(gameId, stream)
    return stream
  }
}
