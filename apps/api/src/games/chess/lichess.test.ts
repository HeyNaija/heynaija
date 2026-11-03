import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpLichess, LichessError, parseBoardEvent, ratingsOf } from './lichess.js'

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined }

/** A stand-in for fetch: records each call and answers with `reply`. */
function fake(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body as string | undefined }
    calls.push(call)
    return reply(call)
  }) as unknown as typeof fetch
  return { calls, client: new HttpLichess('https://lichess.test', fetchFn) }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const refusal = async (run: () => Promise<unknown>): Promise<LichessError> => {
  try {
    await run()
  } catch (err) {
    if (err instanceof LichessError) return err
    throw err
  }
  assert.fail('expected a LichessError')
}

test('the authorize address asks for PKCE with S256 and only the scopes needed', () => {
  const { client } = fake(() => json({}))
  const url = new URL(client.authorizeUrl({ clientId: 'heynaija.ng', redirectUri: 'https://heynaija.ng/games/chess/callback', codeChallenge: 'abc', state: 'xyz' }))
  assert.equal(url.origin + url.pathname, 'https://lichess.test/oauth')
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: 'code',
    client_id: 'heynaija.ng',
    redirect_uri: 'https://heynaija.ng/games/chess/callback',
    code_challenge_method: 'S256',
    code_challenge: 'abc',
    scope: 'challenge:read challenge:write board:play',
    state: 'xyz',
  })
})

test('the code is exchanged as a form with the verifier, and the token comes back with its expiry', async () => {
  const { client, calls } = fake(() => json({ token_type: 'Bearer', access_token: 'lio_tok', expires_in: 3600 }))
  const before = Date.now()
  const token = await client.token({ code: 'c0de', codeVerifier: 'v3r', redirectUri: 'https://x/cb', clientId: 'x' })
  assert.equal(token.accessToken, 'lio_tok')
  assert.ok(token.expiresAt && token.expiresAt.getTime() >= before + 3600_000)
  assert.equal(calls[0]!.method, 'POST')
  assert.equal(calls[0]!.url, 'https://lichess.test/api/token')
  assert.equal(calls[0]!.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0]!.body)), {
    grant_type: 'authorization_code',
    code: 'c0de',
    code_verifier: 'v3r',
    redirect_uri: 'https://x/cb',
    client_id: 'x',
  })
})

test('the account is read with the bearer token, and its ratings kept for the four speeds', async () => {
  const { client, calls } = fake(() =>
    json({
      id: 'Ada',
      username: 'Ada',
      perfs: { blitz: { rating: 1520, games: 40 }, rapid: { rating: 1610, games: 3, prov: true }, bullet: { rating: 2000, games: 9 } },
    }),
  )
  const user = await client.account('lio_tok')
  assert.equal(calls[0]!.headers.authorization, 'Bearer lio_tok')
  assert.deepEqual(user, {
    id: 'ada',
    username: 'Ada',
    ratings: { blitz: { rating: 1520, games: 40, provisional: false }, rapid: { rating: 1610, games: 3, provisional: true } },
  })
})

test('public profiles are read in one call, by id, with no token', async () => {
  const { client, calls } = fake(() => json([{ id: 'ada', username: 'Ada', perfs: {} }, { id: 'bayo', username: 'Bayo' }]))
  assert.deepEqual((await client.users(['ada', 'bayo'])).map((u) => u.id), ['ada', 'bayo'])
  assert.equal(calls[0]!.body, 'ada,bayo')
  assert.equal(calls[0]!.headers.authorization, undefined)
  assert.deepEqual(await client.users([]), [])
  assert.equal(calls.length, 1, 'nothing to ask, nothing asked')
})

test('a challenge is made with the time control as Lichess names it, and accepted with the other token', async () => {
  const { client, calls } = fake((call) => (call.url.endsWith('/accept') ? json({ ok: true }) : json({ id: 'G4me1d' })))
  assert.deepEqual(await client.createChallenge('a_tok', 'Bayo', { rated: true, color: 'white', clockLimit: 600, clockIncrement: 5 }), { id: 'G4me1d' })
  assert.equal(calls[0]!.url, 'https://lichess.test/api/challenge/Bayo')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0]!.body)), {
    rated: 'true',
    color: 'white',
    variant: 'standard',
    'clock.limit': '600',
    'clock.increment': '5',
  })
  await client.createChallenge('a_tok', 'bayo', { rated: false, color: 'random', days: 3 })
  assert.equal(new URLSearchParams(calls[1]!.body).get('days'), '3')
  await client.acceptChallenge('b_tok', 'G4me1d')
  assert.equal(calls[2]!.url, 'https://lichess.test/api/challenge/G4me1d/accept')
  assert.equal(calls[2]!.headers.authorization, 'Bearer b_tok')
})

test('answers become kinds of error: refused token, slow down, unavailable, rejected', async () => {
  assert.equal((await refusal(() => fake(() => json({}, 401)).client.account('t'))).kind, 'unauthorized')
  const slow = await refusal(() => fake(() => json({}, 429)).client.account('t'))
  assert.equal(slow.kind, 'rate_limited')
  assert.equal(slow.retryAfterMs, 60_000)
  assert.equal((await refusal(() => fake(() => json({}, 503)).client.account('t'))).kind, 'unavailable')
  assert.equal((await refusal(() => fake(() => json({ error: 'no' }, 400)).client.createChallenge('t', 'x', { rated: true, color: 'random', days: 1 }))).kind, 'rejected')
  assert.equal((await refusal(() => fake(() => { throw new Error('ETIMEDOUT') }).client.account('t'))).kind, 'unavailable')
  assert.equal((await refusal(() => fake(() => new Response('<html>', { status: 200 })).client.account('t'))).kind, 'unavailable')
})

test('an error never carries the token or the code', async () => {
  const err = await refusal(() => fake(() => json({}, 400)).client.token({ code: 'secret-code', codeVerifier: 'secret-verifier', redirectUri: 'x', clientId: 'x' }))
  assert.ok(!err.message.includes('secret'))
  const err2 = await refusal(() => fake(() => json({}, 401)).client.account('secret-token'))
  assert.ok(!err2.message.includes('secret'))
})

test('a speed never played is left out', () => {
  assert.deepEqual(ratingsOf({ classical: { games: 0 } }), {})
  assert.deepEqual(ratingsOf(undefined), {})
})

/** A streamed answer made of `chunks`, as Lichess sends NDJSON a piece at a time. */
const streamed = (chunks: string[], fail = false) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        if (fail) controller.error(new Error('connection reset'))
        else controller.close()
      },
    }),
    { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
  )

test('a game’s stream is read line by line, across chunks, skipping keep-alive blank lines and chat', async () => {
  const full = JSON.stringify({ type: 'gameFull', id: 'g', state: { type: 'gameState', moves: 'e2e4', wtime: 600000, btime: 600000, status: 'started' } })
  const { client, calls } = fake(() =>
    streamed([full.slice(0, 20), `${full.slice(20)}\n\n`, '{"type":"chatLine","text":"hi"}\n', '{"type":"gameState","moves":"e2e4 e7e5","wtime":599000,"btime":600000,"status":"started","bdraw":true}\n']),
  )
  const events = []
  for await (const event of client.streamGame('tok', 'g', new AbortController().signal)) events.push(event)
  assert.equal(calls[0]!.url, 'https://lichess.test/api/board/game/stream/g')
  assert.equal(calls[0]!.headers.authorization, 'Bearer tok')
  assert.deepEqual(events, [
    { type: 'gameFull', state: { moves: 'e2e4', status: 'started', wtime: 600000, btime: 600000, wdraw: false, bdraw: false } },
    { type: 'gameState', moves: 'e2e4 e7e5', status: 'started', wtime: 599000, btime: 600000, wdraw: false, bdraw: true },
  ])
})

test('a stream that breaks off is an error the watcher can retry; a refused one is said plainly', async () => {
  const broken = fake(() => streamed(['{"type":"gameState","moves":"","status":"started"}\n'], true)).client
  await assert.rejects(
    (async () => {
      for await (const _ of broken.streamGame('t', 'g', new AbortController().signal)) void _
    })(),
    (err: LichessError) => err.kind === 'unavailable',
  )
  const refused = fake(() => json({}, 401)).client
  await assert.rejects(
    (async () => {
      for await (const _ of refused.streamGame('t', 'g', new AbortController().signal)) void _
    })(),
    (err: LichessError) => err.kind === 'unauthorized',
  )
})

test('moves, draws, resigning and aborting go to the Board API with the player’s token', async () => {
  const { client, calls } = fake(() => json({ ok: true }))
  await client.move('tok', 'g', 'e7e8q')
  await client.draw('tok', 'g', 'yes')
  await client.resign('tok', 'g')
  await client.abort('tok', 'g')
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.replace('https://lichess.test', '')}`),
    ['POST /api/board/game/g/move/e7e8q', 'POST /api/board/game/g/draw/yes', 'POST /api/board/game/g/resign', 'POST /api/board/game/g/abort'],
  )
  assert.ok(calls.every((c) => c.headers.authorization === 'Bearer tok'))
})

test('stream lines this code does not use, or cannot read, are left out', () => {
  assert.equal(parseBoardEvent('not json'), null)
  assert.equal(parseBoardEvent('{"type":"opponentGone","gone":true}'), null)
  assert.equal(parseBoardEvent('{"type":"gameState"}'), null)
})
