// For tests only: a stand-in for Lichess that records every call and lets a test
// play out a game's Board API stream event by event.
import { type BoardEvent, type ChallengeRequest, LichessError, type LichessApi, type LichessUser } from './lichess.js'

type Stream = { events: (BoardEvent | null)[]; wake?: () => void }

export class FakeLichess implements LichessApi {
  calls: string[] = []
  accounts = new Map<string, LichessUser>()
  fail: Partial<Record<'token' | 'revoke' | 'users' | 'create' | 'accept' | 'move' | 'draw' | 'resign' | 'abort' | 'stream', LichessError>> = {}
  next = 1
  private readonly streams = new Map<string, Stream>()

  /** Lichess-shaped game ids: eight characters. */
  gameId(n: number) {
    return `gm${String(n).padStart(6, '0')}`
  }

  authorizeUrl({ clientId, redirectUri, codeChallenge, state }: Parameters<LichessApi['authorizeUrl']>[0]) {
    return `https://lichess.test/oauth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state })}`
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
