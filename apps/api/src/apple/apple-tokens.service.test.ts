import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { appleTokens, members } from '@heynaija/db'
import { db, migrate, pool, reset } from '../test-db.js'
import { AppleCodeRefusedError, AppleTokensService } from './apple-tokens.service.js'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const env = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: p8, APPLE_BUNDLE_ID: 'ng.heynaija.app' }
const ada = randomUUID()

/** Apple's token and revoke endpoints, standing in: each answers with what its queue holds next. */
function apple() {
  const requests: { url: string; form: URLSearchParams }[] = []
  const answers: { status: number; body?: unknown }[] = []
  let issued = 0
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), form: new URLSearchParams(String(init?.body)) })
    const answer = answers.shift() ?? (String(url).endsWith('/auth/token') ? { status: 200, body: { refresh_token: `r.${++issued}`, id_token: 'x' } } : { status: 200 })
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status })
  }) as typeof fetch
  return { http, requests, answers }
}

const kept = async () => (await db.select({ memberId: appleTokens.memberId, refreshToken: appleTokens.refreshToken }).from(appleTokens))

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values({ id: ada, handle: 'ada' })
})
after(() => pool.end())

test('trades the app’s code for a refresh token, signing in as the app with the team’s key', async () => {
  const a = apple()
  const tokens = new AppleTokensService(db, env, a.http)
  tokens.now = () => 1_800_000_000_000
  await tokens.keep(ada, 'c.code-from-the-app')
  assert.deepEqual(await kept(), [{ memberId: ada, refreshToken: 'r.1' }])

  const [request] = a.requests
  assert.equal(request!.url, 'https://appleid.apple.com/auth/token')
  assert.equal(request!.form.get('client_id'), 'ng.heynaija.app')
  assert.equal(request!.form.get('grant_type'), 'authorization_code')
  assert.equal(request!.form.get('code'), 'c.code-from-the-app')
  const [header, claims, signature] = request!.form.get('client_secret')!.split('.')
  assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url')))
  assert.deepEqual(JSON.parse(Buffer.from(header!, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567' })
  assert.deepEqual(JSON.parse(Buffer.from(claims!, 'base64url').toString()), {
    iss: 'TEAM123456',
    iat: 1_800_000_000,
    exp: 1_800_000_300,
    aud: 'https://appleid.apple.com',
    sub: 'ng.heynaija.app',
  })

  // Signing in with Apple again replaces it.
  await tokens.keep(ada, 'c.another')
  assert.deepEqual(await kept(), [{ memberId: ada, refreshToken: 'r.2' }])
})

test('a code Apple refuses is said so, and nothing is kept', async () => {
  const a = apple()
  const tokens = new AppleTokensService(db, env, a.http)
  a.answers.push({ status: 400, body: { error: 'invalid_grant' } })
  await assert.rejects(tokens.keep(ada, 'c.used'), AppleCodeRefusedError)
  a.answers.push({ status: 503 })
  await assert.rejects(tokens.keep(ada, 'c.later'), (error: Error) => !(error instanceof AppleCodeRefusedError))
  assert.deepEqual(await kept(), [])
})

test('revoking sends the refresh token back to Apple, then forgets it; Apple being down leaves it for the next try', async () => {
  const a = apple()
  const tokens = new AppleTokensService(db, env, a.http)
  await tokens.keep(ada, 'c.code')
  a.answers.push({ status: 503 })
  await assert.rejects(tokens.revokeFor(ada), /503/)
  assert.equal((await kept()).length, 1)

  await tokens.revokeFor(ada)
  const revoke = a.requests.at(-1)!
  assert.equal(revoke.url, 'https://appleid.apple.com/auth/revoke')
  assert.equal(revoke.form.get('token'), 'r.1')
  assert.equal(revoke.form.get('token_type_hint'), 'refresh_token')
  assert.equal(revoke.form.get('client_id'), 'ng.heynaija.app')
  assert.ok(revoke.form.get('client_secret'))
  assert.deepEqual(await kept(), [])

  // Nothing kept: nothing to do.
  const before = a.requests.length
  await tokens.revokeFor(ada)
  assert.equal(a.requests.length, before)
})

test('a token Apple will not revoke, or one kept without the key now, is forgotten rather than tried for ever', async () => {
  const a = apple()
  await db.insert(appleTokens).values({ memberId: ada, refreshToken: 'r.revoked-by-the-member' })
  a.answers.push({ status: 400, body: { error: 'invalid_client' } })
  await new AppleTokensService(db, env, a.http).revokeFor(ada)
  assert.deepEqual(await kept(), [])

  await db.insert(appleTokens).values({ memberId: ada, refreshToken: 'r.old' })
  const keyless = new AppleTokensService(db, { APPLE_BUNDLE_ID: 'ng.heynaija.app' }, a.http)
  assert.equal(keyless.enabled, false)
  const sent = a.requests.length
  await keyless.revokeFor(ada)
  assert.equal(a.requests.length, sent)
  assert.deepEqual(await kept(), [])
})
