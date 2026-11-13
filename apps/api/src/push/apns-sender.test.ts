import assert from 'node:assert/strict'
import { createDecipheriv, createHmac, generateKeyPairSync, randomBytes, verify } from 'node:crypto'
import { createServer } from 'node:http2'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { ApnsSender, apnsSender, http2Transport } from './apns-sender.js'
import { PermanentPushError, type PushMessage, SubscriptionGoneError } from './push-sender.js'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const key = { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem, bundleId: 'ng.heynaija.app' }
const appKey = randomBytes(32)
const target = { service: 'apns' as const, token: 'a1b2'.repeat(16), key: appKey.toString('base64url'), memberId: 'member-1' }
const message: PushMessage = { title: '@bayo replied to your post', body: '“Jollof, obviously”', url: '/p/1', tag: 'reply:1' }

/** What the app's notification service extension does with `sealed`: AES-256-GCM, the nonce first and the tag last. */
const open = (sealed: string) => {
  const bytes = Buffer.from(sealed, 'base64url')
  const decipher = createDecipheriv('aes-256-gcm', appKey, bytes.subarray(0, 12))
  decipher.setAuthTag(bytes.subarray(-16))
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
}

/** Apple, standing in: answers each request with what the queue holds next, 200 when it is empty. */
function apple() {
  const requests: { url: string; headers: Record<string, string>; body: string }[] = []
  const answers: { status: number; reason?: string }[] = []
  const transport = async (url: string, headers: Record<string, string>, body: string) => {
    requests.push({ url, headers, body })
    const answer = answers.shift() ?? { status: 200 }
    return { status: answer.status, body: answer.reason ? JSON.stringify({ reason: answer.reason }) : '' }
  }
  return { transport, requests, answers }
}

const jwtParts = (authorization: string) => {
  const [header, claims, signature] = authorization.replace(/^bearer /, '').split('.')
  return {
    header: JSON.parse(Buffer.from(header!, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(claims!, 'base64url').toString()),
    valid: verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url')),
  }
}

test('no sender without the whole Apple key', () => {
  assert.equal(apnsSender({ APPLE_BUNDLE_ID: 'ng.heynaija.app' }), null)
  assert.equal(apnsSender({ APPLE_TEAM_ID: key.teamId, APPLE_BUNDLE_ID: 'ng.heynaija.app' }), null)
  assert.ok(apnsSender({ APPLE_TEAM_ID: key.teamId, APPLE_KEY_ID: key.keyId, APPLE_PRIVATE_KEY: pem, APPLE_BUNDLE_ID: 'ng.heynaija.app' }))
})

test('sends a sealed alert to the device on Apple’s service, signed with the team’s key', async () => {
  const a = apple()
  await new ApnsSender(key, a.transport, () => 1_800_000_000_000).send(target, message)

  const [sent] = a.requests
  assert.equal(sent!.url, `https://api.push.apple.com/3/device/${target.token}`)
  const jwt = jwtParts(sent!.headers.authorization!)
  assert.ok(jwt.valid)
  assert.deepEqual(jwt.header, { alg: 'ES256', kid: 'KEY1234567' })
  assert.deepEqual(jwt.claims, { iss: 'TEAM123456', iat: 1_800_000_000 })
  assert.equal(sent!.headers['apns-topic'], 'ng.heynaija.app')
  assert.equal(sent!.headers['apns-push-type'], 'alert')
  assert.equal(sent!.headers['apns-priority'], '10')
  assert.equal(sent!.headers['apns-expiration'], String(1_800_000_000 + 86_400))
  // The tag decides what it replaces, but Apple sees only a keyed hash of it.
  assert.equal(sent!.headers['apns-collapse-id'], createHmac('sha256', appKey).update('reply:1').digest('base64url'))
  assert.ok(sent!.headers['apns-collapse-id']!.length <= 64)

  const payload = JSON.parse(sent!.body)
  // Nothing Apple can read but the stand-in the extension replaces.
  assert.deepEqual(payload.aps, { alert: { title: 'HeyNaija', body: 'You have a new notification.' }, 'mutable-content': 1, sound: 'default' })
  assert.deepEqual(Object.keys(payload).sort(), ['aps', 'sealed'])
  assert.deepEqual(JSON.parse(open(payload.sealed)), { ...message, member: 'member-1' })
  assert.ok(!sent!.body.includes('bayo'))
})

test('a build run from Xcode is sent through the sandbox', async () => {
  const a = apple()
  await new ApnsSender(key, a.transport).send({ ...target, service: 'apns_sandbox' }, message)
  assert.equal(a.requests[0]!.url, `https://api.sandbox.push.apple.com/3/device/${target.token}`)
  await assert.rejects(new ApnsSender(key, a.transport).send({ ...target, service: 'fcm' }, message), PermanentPushError)
})

test('keeps its provider token for 40 minutes, then signs a new one', async () => {
  const a = apple()
  let now = 1_800_000_000_000
  const sender = new ApnsSender(key, a.transport, () => now)
  await sender.send(target, message)
  now += 39 * 60_000
  await sender.send(target, message)
  now += 60_000
  await sender.send(target, message)
  const issued = a.requests.map((r) => jwtParts(r.headers.authorization!).claims.iat)
  assert.deepEqual(issued, [1_800_000_000, 1_800_000_000, 1_800_000_000 + 40 * 60])
})

test('a token Apple no longer knows is gone; busy is tried again; a refusal for good is not', async () => {
  const a = apple()
  const sender = new ApnsSender(key, a.transport)
  for (const [status, reason] of [[410, 'Unregistered'], [400, 'BadDeviceToken'], [400, 'DeviceTokenNotForTopic']] as const) {
    a.answers.push({ status, reason })
    await assert.rejects(sender.send(target, message), SubscriptionGoneError)
  }
  for (const [status, reason] of [[429, 'TooManyRequests'], [503, 'ServiceUnavailable'], [500, 'InternalServerError']] as const) {
    a.answers.push({ status, reason })
    await assert.rejects(sender.send(target, message), (error: Error) => !(error instanceof PermanentPushError) && !(error instanceof SubscriptionGoneError))
  }
  for (const [status, reason] of [[400, 'PayloadTooLarge'], [403, 'InvalidProviderToken'], [400, 'TopicDisallowed']] as const) {
    a.answers.push({ status, reason })
    await assert.rejects(sender.send(target, message), (error: Error) => error instanceof PermanentPushError && error.message.includes(reason))
  }
})

test('an expired provider token is tried again with a new one', async () => {
  const a = apple()
  let now = 1_800_000_000_000
  const sender = new ApnsSender(key, a.transport, () => now)
  a.answers.push({ status: 403, reason: 'ExpiredProviderToken' })
  await assert.rejects(sender.send(target, message), (error: Error) => !(error instanceof PermanentPushError))
  now += 1000
  await sender.send(target, message)
  assert.notEqual(a.requests[0]!.headers.authorization, a.requests[1]!.headers.authorization)
})

test('the HTTP/2 transport posts to the path and reads the answer, over one connection', async () => {
  const server = createServer()
  const seen: { path: string; topic: string; body: string }[] = []
  const connections: import('node:http2').ServerHttp2Session[] = []
  server.on('session', (session) => connections.push(session))
  server.on('stream', (stream, headers) => {
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => {
      seen.push({ path: String(headers[':path']), topic: String(headers['apns-topic']), body: Buffer.concat(chunks).toString() })
      const gone = String(headers[':path']).endsWith('/gone')
      stream.respond({ ':status': gone ? 410 : 200 })
      stream.end(gone ? JSON.stringify({ reason: 'Unregistered' }) : undefined)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const send = http2Transport()
    const ok = await send(`http://127.0.0.1:${port}/3/device/abc`, { 'apns-topic': 'ng.heynaija.app' }, '{"aps":{}}')
    const gone = await send(`http://127.0.0.1:${port}/3/device/gone`, { 'apns-topic': 'ng.heynaija.app' }, '{}')
    assert.deepEqual(ok, { status: 200, body: '' })
    assert.deepEqual(gone, { status: 410, body: '{"reason":"Unregistered"}' })
    assert.deepEqual(seen, [
      { path: '/3/device/abc', topic: 'ng.heynaija.app', body: '{"aps":{}}' },
      { path: '/3/device/gone', topic: 'ng.heynaija.app', body: '{}' },
    ])
    assert.equal(connections.length, 1)
  } finally {
    for (const session of connections) session.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
