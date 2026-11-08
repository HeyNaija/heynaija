import assert from 'node:assert/strict'
import { createDecipheriv, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { test } from 'node:test'
import { FcmSender, fcmSender, seal } from './fcm-sender.js'
import { PermanentPushError, type PushMessage, SubscriptionGoneError } from './push-sender.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const account = {
  projectId: 'heynaija-test',
  clientEmail: 'firebase-adminsdk@heynaija-test.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
}
const appKey = randomBytes(32)
const target = { service: 'fcm' as const, token: 'device-token:APA91b', key: appKey.toString('base64url'), memberId: 'member-1' }

/** What the app does with `sealed`: AES-256-GCM with its key, the nonce first and the tag last. */
const open = (key: Buffer, sealed: string) => {
  const bytes = Buffer.from(sealed, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(-16))
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
}
const message: PushMessage = { title: '@bayo replied to your post', body: '“Jollof, obviously”', url: '/p/1', tag: 'reply:1' }

/** Google, standing in: the token endpoint and FCM answer with what each queue holds next. */
function google() {
  const requests: { url: string; headers: Record<string, string>; body: string }[] = []
  const tokens: { status: number; body?: unknown }[] = []
  const sends: { status: number; body?: unknown }[] = []
  let issued = 0
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url)
    requests.push({ url: href, headers: init?.headers as Record<string, string>, body: String(init?.body) })
    const answer = href === 'https://oauth2.googleapis.com/token'
      ? (tokens.shift() ?? { status: 200, body: { access_token: `access-${++issued}`, expires_in: 3599, token_type: 'Bearer' } })
      : (sends.shift() ?? { status: 200, body: { name: 'projects/heynaija-test/messages/1' } })
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status })
  }) as typeof fetch
  return { http, requests, tokens, sends, signIns: () => requests.filter((r) => r.url.endsWith('/token')) }
}

const fcmError = (status: number, code: string, errorCode?: string) => ({
  status,
  body: {
    error: {
      code: status,
      message: 'refused',
      status: code,
      details: errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : [],
    },
  },
})

test('no sender without a service account', () => {
  assert.equal(fcmSender({}), null)
  assert.ok(fcmSender({ FCM_SERVICE_ACCOUNT: account }))
})

test('signs in as the service account with a JWT it signs, then sends a data message to the token', async () => {
  const g = google()
  await new FcmSender(account, g.http, () => 1_800_000_000_000).send(target, message)

  const [signIn, send] = g.requests
  const form = new URLSearchParams(signIn!.body)
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  const [header, claims, signature] = form.get('assertion')!.split('.')
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature!, 'base64url')))
  assert.deepEqual(JSON.parse(Buffer.from(header!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' })
  assert.deepEqual(JSON.parse(Buffer.from(claims!, 'base64url').toString()), {
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_800_000_000,
    exp: 1_800_003_600,
  })

  assert.equal(send!.url, 'https://fcm.googleapis.com/v1/projects/heynaija-test/messages:send')
  assert.equal(send!.headers.authorization, 'Bearer access-1')
  const sent = JSON.parse(send!.body)
  // No `notification`, and nothing FCM can read: the app opens it, shows it, and knows whose it is.
  assert.deepEqual(Object.keys(sent.message.data), ['sealed'])
  assert.deepEqual(JSON.parse(open(appKey, sent.message.data.sealed)), { ...message, member: 'member-1' })
  assert.deepEqual({ ...sent.message, data: undefined }, { token: 'device-token:APA91b', data: undefined, android: { priority: 'HIGH', ttl: '86400s' } })
})

test('each message is sealed with a fresh nonce, and anything changed in it fails to open', () => {
  const a = seal(target.key, 'the same text')
  const b = seal(target.key, 'the same text')
  assert.notEqual(a, b)
  assert.equal(open(appKey, a), 'the same text')
  const tampered = Buffer.from(a, 'base64url')
  tampered[14] = tampered[14]! ^ 1
  assert.throws(() => open(appKey, tampered.toString('base64url')))
  assert.throws(() => open(randomBytes(32), a))
})

test('one access token serves every send until shortly before it runs out, and sends at once share a sign-in', async () => {
  const g = google()
  let now = 1_800_000_000_000
  const sender = new FcmSender(account, g.http, () => now)
  await Promise.all([sender.send(target, message), sender.send(target, message), sender.send(target, message)])
  assert.equal(g.signIns().length, 1)

  now += 50 * 60_000
  await sender.send(target, message)
  assert.equal(g.signIns().length, 1)

  // Five minutes before the hour is up, a new one.
  now += 5 * 60_000
  await sender.send(target, message)
  assert.equal(g.signIns().length, 2)
  assert.equal(g.requests.at(-1)!.headers.authorization, 'Bearer access-2')
})

test('a removed app, or a token from another project, is gone; other refusals are for good or worth a retry', async () => {
  const cases: [{ status: number; body?: unknown }, (error: unknown) => boolean][] = [
    [fcmError(404, 'NOT_FOUND', 'UNREGISTERED'), (e) => e instanceof SubscriptionGoneError],
    [fcmError(403, 'PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), (e) => e instanceof SubscriptionGoneError],
    // A wrong project ID is a 404 too, without UNREGISTERED: no token is thrown away for it.
    [fcmError(404, 'NOT_FOUND'), (e) => e instanceof PermanentPushError],
    [fcmError(400, 'INVALID_ARGUMENT', 'INVALID_ARGUMENT'), (e) => e instanceof PermanentPushError],
    [fcmError(429, 'RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), (e) => !(e instanceof PermanentPushError) && !(e instanceof SubscriptionGoneError)],
    [fcmError(503, 'UNAVAILABLE', 'UNAVAILABLE'), (e) => !(e instanceof PermanentPushError) && !(e instanceof SubscriptionGoneError)],
    [{ status: 502 }, (e) => !(e instanceof PermanentPushError) && !(e instanceof SubscriptionGoneError)],
  ]
  for (const [answer, expected] of cases) {
    const g = google()
    g.sends.push(answer)
    await assert.rejects(new FcmSender(account, g.http).send(target, message), expected, JSON.stringify(answer))
  }
})

test('an access token refused early is dropped, and the next send signs in again', async () => {
  const g = google()
  const sender = new FcmSender(account, g.http)
  g.sends.push(fcmError(401, 'UNAUTHENTICATED'))
  await assert.rejects(sender.send(target, message), (e) => !(e instanceof PermanentPushError) && !(e instanceof SubscriptionGoneError))
  await sender.send(target, message)
  assert.equal(g.signIns().length, 2)
})

test('a failed sign-in is tried again on the next send', async () => {
  const g = google()
  const sender = new FcmSender(account, g.http)
  g.tokens.push({ status: 400, body: { error: 'invalid_grant' } })
  await assert.rejects(sender.send(target, message), /token endpoint answered 400/)
  await sender.send(target, message)
  assert.equal(g.signIns().length, 2)
  assert.equal(g.requests.filter((r) => r.url.includes('messages:send')).length, 1)
})
