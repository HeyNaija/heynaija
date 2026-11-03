// A stand-in for lichess.org, for the chess end-to-end tests (docs/adr/0018).
// The API is pointed at it with LICHESS_URL. It does what HeyNaija asks of
// Lichess: the OAuth consent page (with PKCE checked properly), the account,
// public profiles, and making, accepting and cancelling challenges. Everything is
// kept in memory and forgotten when it stops.
//
//   node --experimental-strip-types e2e/lib/fake-lichess.ts      (port 8790, or FAKE_LICHESS_PORT)
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

/** Every account has these ratings, so a test knows what to look for. */
export const FAKE_RATINGS = { blitz: { rating: 1500, games: 12 }, rapid: { rating: 1620, games: 30 } }

type Grant = { username: string; challenge: string; redirectUri: string }

export function fakeLichess() {
  const grants = new Map<string, Grant>()
  const challenges = new Map<string, { from: string; to: string; status: string }>()
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
      challenges.set(id, { from, to: decodeURIComponent(made[1]!).toLowerCase(), status: 'created' })
      return send(res, 200, { id, url: `http://fake/${id}`, status: 'created' })
    }
    const answer = /^\/api\/challenge\/([^/]+)\/(accept|cancel)$/.exec(path)
    if (req.method === 'POST' && answer) {
      const c = challenges.get(answer[1]!)
      const who = bearer(req)?.toLowerCase()
      if (!c || !who) return send(res, 404, { error: 'not found' })
      if (answer[2] === 'accept' && who !== c.to) return send(res, 400, { error: 'not yours' })
      c.status = answer[2] === 'accept' ? 'accepted' : 'canceled'
      return send(res, 200, { ok: true })
    }
    // The game page an accepted challenge links to.
    if (req.method === 'GET' && /^\/[0-9a-f]{8}$/.test(path)) return send(res, 200, `<!doctype html><title>Game</title><h1>Game ${path.slice(1)}</h1>`, 'text/html')
    return send(res, 404, { error: 'not found' })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.FAKE_LICHESS_PORT ?? 8790)
  fakeLichess().listen(port, '127.0.0.1', () => console.log(`fake Lichess on http://127.0.0.1:${port}`))
}
