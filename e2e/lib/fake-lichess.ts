// A stand-in for lichess.org, for the chess end-to-end tests (docs/adr/0028).
// The API is pointed at it with LICHESS_URL. It does what HeyNaija asks of
// Lichess: the OAuth consent page (with PKCE checked properly), the account,
// public profiles, making, accepting and cancelling challenges, and (phase 6)
// teams and their Arena and Swiss tournaments. Everything is kept in memory and
// forgotten when it stops. Tests set teams and tournament results through
// /_test/team and /_test/tournament/<id>.
//
//   node --experimental-strip-types e2e/lib/fake-lichess.ts      (port 8790, or FAKE_LICHESS_PORT)
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/** Every account has these ratings, so a test knows what to look for. */
export const FAKE_RATINGS = { blitz: { rating: 1500, games: 12 }, rapid: { rating: 1620, games: 30 } }

type Grant = { username: string; challenge: string; redirectUri: string }

export function fakeLichess() {
  const grants = new Map<string, Grant>()
  const challenges = new Map<string, { from: string; to: string; status: string; color: string; days: boolean }>()
  // Games once a challenge is accepted: moves are recorded as sent, not checked (Lichess checks; this stands in).
  type Game = { white: string; black: string; moves: string[]; status: string; winner?: 'white' | 'black'; wdraw: boolean; bdraw: boolean; watchers: Set<ServerResponse> }
  const games = new Map<string, Game>()
  // Teams by id, and tournaments as they were made; a test says who leads a team and how a tournament went.
  const teams = new Map<string, { id: string; name: string; nbMembers: number; leaders: { id: string; name: string }[] }>()
  type Tournament = { kind: 'arena' | 'swiss'; by: string; form: Record<string, string>; status: 'created' | 'started' | 'finished'; results: { rank: number; username: string; score: number }[] }
  const tournaments = new Map<string, Tournament>()
  const stateOf = (g: Game) => ({
    type: 'gameState',
    moves: g.moves.join(' '),
    wtime: 600_000,
    btime: 600_000,
    status: g.status,
    ...(g.winner ? { winner: g.winner } : {}),
    wdraw: g.wdraw,
    bdraw: g.bdraw,
  })
  const tell = (g: Game) => {
    for (const watcher of g.watchers) {
      watcher.write(`${JSON.stringify(stateOf(g))}\n`)
      if (g.status !== 'started') watcher.end()
    }
    if (g.status !== 'started') g.watchers.clear()
  }
  const user = (name: string) => ({ id: name.toLowerCase(), username: name, perfs: FAKE_RATINGS })
  const bearer = (req: IncomingMessage) => /^Bearer tok_(.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null

  const send = (res: ServerResponse, status: number, body?: unknown, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type })
    res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body))
  }
  const read = (req: IncomingMessage) =>
    new Promise<string>((done) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => done(data))
    })

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake')
    const path = url.pathname
    const body = req.method === 'GET' ? '' : await read(req)
    const form = new URLSearchParams(body)

    // The consent page: whoever is "signed in to Lichess" types their username and says yes.
    if (req.method === 'GET' && path === '/oauth') {
      const q = url.searchParams
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) return send(res, 400, 'bad request', 'text/plain')
      const hidden = ['redirect_uri', 'state', 'code_challenge', 'client_id', 'scope']
        .map((k) => `<input type="hidden" name="${k}" value="${(q.get(k) ?? '').replace(/"/g, '&quot;')}">`)
        .join('')
      return send(
        res,
        200,
        `<!doctype html><title>Fake Lichess</title><h1>Authorize ${q.get('client_id')}</h1><p>Scopes: ${q.get('scope')}</p>
        <form method="post" action="/oauth/authorize">${hidden}<label>Lichess username <input name="username" required></label>
        <button name="answer" value="yes">Authorize</button><button name="answer" value="no" formnovalidate>Cancel</button></form>`,
        'text/html',
      )
    }
    if (req.method === 'POST' && path === '/oauth/authorize') {
      const back = new URL(form.get('redirect_uri') ?? '')
      if (form.get('answer') !== 'yes') {
        back.search = new URLSearchParams({ error: 'access_denied', state: form.get('state') ?? '' }).toString()
      } else {
        const code = randomBytes(12).toString('hex')
        grants.set(code, { username: form.get('username') ?? '', challenge: form.get('code_challenge') ?? '', redirectUri: back.toString() })
        back.search = new URLSearchParams({ code, state: form.get('state') ?? '' }).toString()
      }
      res.writeHead(303, { location: back.toString() })
      return res.end()
    }
    if (req.method === 'POST' && path === '/api/token') {
      const grant = grants.get(form.get('code') ?? '')
      grants.delete(form.get('code') ?? '')
      const verified = grant && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge
      if (!grant || !verified || form.get('redirect_uri') !== grant.redirectUri) return send(res, 400, { error: 'invalid_grant' })
      return send(res, 200, { token_type: 'Bearer', access_token: `tok_${grant.username}`, expires_in: 31_536_000 })
    }
    if (req.method === 'DELETE' && path === '/api/token') return send(res, 204)
    if (req.method === 'GET' && path === '/api/account') {
      const name = bearer(req)
      return name ? send(res, 200, user(name)) : send(res, 401, { error: 'no token' })
    }
    if (req.method === 'POST' && path === '/api/users') return send(res, 200, body.split(',').filter(Boolean).map(user))

    const made = /^\/api\/challenge\/([^/]+)$/.exec(path)
    if (req.method === 'POST' && made) {
      const from = bearer(req)
      if (!from) return send(res, 401, { error: 'no token' })
      const id = randomBytes(4).toString('hex')
      challenges.set(id, { from: from.toLowerCase(), to: decodeURIComponent(made[1]!).toLowerCase(), status: 'created', color: form.get('color') ?? 'white', days: form.has('days') })
      return send(res, 200, { id, url: `http://fake/${id}`, status: 'created' })
    }
    const answer = /^\/api\/challenge\/([^/]+)\/(accept|cancel)$/.exec(path)
    if (req.method === 'POST' && answer) {
      const c = challenges.get(answer[1]!)
      const who = bearer(req)?.toLowerCase()
      if (!c || !who) return send(res, 404, { error: 'not found' })
      if (answer[2] === 'accept' && who !== c.to) return send(res, 400, { error: 'not yours' })
      c.status = answer[2] === 'accept' ? 'accepted' : 'canceled'
      if (answer[2] === 'accept') {
        const challengerWhite = c.color !== 'black'
        games.set(answer[1]!, { white: challengerWhite ? c.from : c.to, black: challengerWhite ? c.to : c.from, moves: [], status: 'started', wdraw: false, bdraw: false, watchers: new Set() })
      }
      return send(res, 200, { ok: true })
    }

    // The Board API: a game's stream, and the players' moves and decisions.
    const stream = /^\/api\/board\/game\/stream\/([^/]+)$/.exec(path)
    if (req.method === 'GET' && stream) {
      const g = games.get(stream[1]!)
      if (!bearer(req)) return send(res, 401, { error: 'no token' })
      if (!g) return send(res, 404, { error: 'no such game' })
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ type: 'gameFull', id: stream[1], state: stateOf(g) })}\n`)
      if (g.status !== 'started') return res.end()
      g.watchers.add(res)
      req.on('close', () => g.watchers.delete(res))
      return
    }
    const board = /^\/api\/board\/game\/([^/]+)\/(move|draw|resign|abort)(?:\/([^/]+))?$/.exec(path)
    if (req.method === 'POST' && board) {
      const g = games.get(board[1]!)
      const who = bearer(req)?.toLowerCase()
      if (!g || !who) return send(res, 404, { error: 'not found' })
      const side = who === g.white ? 'white' : who === g.black ? 'black' : null
      if (!side || g.status !== 'started') return send(res, 400, { error: 'not now' })
      const other = side === 'white' ? 'black' : 'white'
      if (board[2] === 'move') {
        if ((g.moves.length % 2 === 0 ? 'white' : 'black') !== side) return send(res, 400, { error: 'not your turn' })
        g.moves.push(board[3]!)
        g.wdraw = g.bdraw = false
      } else if (board[2] === 'draw') {
        if (board[3] === 'yes') {
          if (side === 'white' ? g.bdraw : g.wdraw) g.status = 'draw'
          else if (side === 'white') g.wdraw = true
          else g.bdraw = true
        } else g.wdraw = g.bdraw = false
      } else if (board[2] === 'resign') {
        g.status = 'resign'
        g.winner = other
      } else {
        if (g.moves.length >= 2) return send(res, 400, { error: 'too late to abort' })
        g.status = 'aborted'
      }
      tell(g)
      return send(res, 200, { ok: true })
    }
    // Teams and tournaments (phase 6).
    if (req.method === 'POST' && path === '/_test/team') {
      const t = JSON.parse(body) as { id: string; name: string; leader: string }
      teams.set(t.id, { id: t.id, name: t.name, nbMembers: 3, leaders: [{ id: t.leader.toLowerCase(), name: t.leader }] })
      return send(res, 204)
    }
    const setTournament = /^\/_test\/tournament\/([^/]+)$/.exec(path)
    if (req.method === 'POST' && setTournament) {
      const t = tournaments.get(setTournament[1]!)
      if (!t) return send(res, 404, { error: 'no such tournament' })
      Object.assign(t, JSON.parse(body))
      return send(res, 204)
    }
    const team = /^\/api\/team\/([^/]+)$/.exec(path)
    if (req.method === 'GET' && team) {
      const t = teams.get(decodeURIComponent(team[1]!))
      return t ? send(res, 200, { ...t, leader: t.leaders[0] }) : send(res, 404, { error: 'not found' })
    }
    const create = path === '/api/tournament' ? 'arena' : /^\/api\/swiss\/new\/[^/]+$/.test(path) ? 'swiss' : null
    if (req.method === 'POST' && create) {
      const by = bearer(req)
      if (!by) return send(res, 401, { error: 'no token' })
      const id = randomBytes(4).toString('hex')
      tournaments.set(id, { kind: create, by: by.toLowerCase(), form: Object.fromEntries(form), status: 'created', results: [] })
      return send(res, 200, { id })
    }
    const about = /^\/api\/(tournament|swiss)\/([^/]+)(?:\/(results|terminate))?$/.exec(path)
    if (about) {
      const t = tournaments.get(about[2]!)
      if (!t) return send(res, 404, { error: 'not found' })
      if (about[3] === 'terminate' && req.method === 'POST') {
        t.status = 'finished'
        return send(res, 200, { ok: true })
      }
      if (about[3] === 'results') {
        const lines = t.results.map((r) => JSON.stringify(t.kind === 'arena' ? { rank: r.rank, username: r.username, score: r.score } : { rank: r.rank, username: r.username, points: r.score / 2 }))
        return send(res, 200, lines.map((l) => `${l}\n`).join(''), 'application/x-ndjson')
      }
      const nbPlayers = t.results.length
      return send(res, 200, t.kind === 'arena' ? { id: about[2], isFinished: t.status === 'finished', secondsToStart: t.status === 'created' ? 600 : 0, nbPlayers } : { id: about[2], status: t.status, nbPlayers })
    }
    // A tournament's and a team's pages on lichess.org.
    if (req.method === 'GET' && /^\/(tournament|swiss|team)\/[^/]+$/.test(path)) return send(res, 200, `<!doctype html><title>Lichess</title><h1>${path}</h1>`, 'text/html')
    // The game page an accepted challenge links to.
    if (req.method === 'GET' && /^\/[0-9a-f]{8}$/.test(path)) return send(res, 200, `<!doctype html><title>Game</title><h1>Game ${path.slice(1)}</h1>`, 'text/html')
    return send(res, 404, { error: 'not found' })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.FAKE_LICHESS_PORT ?? 8790)
  fakeLichess().listen(port, '127.0.0.1', () => console.log(`fake Lichess on http://127.0.0.1:${port}`))
}
