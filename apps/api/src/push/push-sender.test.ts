import assert from 'node:assert/strict'
import { createECDH, createHmac, createDecipheriv, createPublicKey, randomBytes, verify } from 'node:crypto'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { isPushServiceUrl, PermanentPushError, SubscriptionGoneError, WebPushSender, webPushSender } from './push-sender.js'

test('only the browsers’ push services are sent to', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
    'https://web.push.apple.com/QGuQyavXutnMHyGeDWBUjzR',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
  ]) {
    assert.equal(isPushServiceUrl(ok), true, ok)
  }
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://user:pass@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.test/fcm/send/abc',
    'https://evilpush.apple.com.example/x',
    'https://push.apple.com.evil.test/x',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'http://127.0.0.1:4599/push/x',
    'not a url',
  ]) {
    assert.equal(isPushServiceUrl(bad), false, bad)
  }
  // The end-to-end tests' stand-in, and only it, when allowed.
  assert.equal(isPushServiceUrl('http://127.0.0.1:4599/push/x', true), true)
  assert.equal(isPushServiceUrl('http://localhost:4599/push/x', true), false)
  assert.equal(isPushServiceUrl('http://10.0.0.5/push/x', true), false)
})

test('no sender without VAPID keys', () => {
  assert.equal(webPushSender({ WEB_PUBLIC_URL: 'https://heynaija.ng' }), null)
  const sender = webPushSender({ WEB_PUBLIC_URL: 'https://heynaija.ng', ...vapidKeys() })
  assert.ok(sender)
})

// A stand-in push service: answers each request with the next status in `answers`.
const received: { url: string; headers: IncomingHttpHeaders; body: Buffer }[] = []
const answers: number[] = []
const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    received.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) })
    res.writeHead(answers.shift() ?? 201).end()
  })
})
let origin = ''
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => new Promise<void>((resolve) => server.close(() => resolve())))

function vapidKeys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { PUSH_VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'), PUSH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url') }
}

/** A browser's side of a subscription: its key pair and auth secret. */
function browser() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const auth = randomBytes(16)
  return { ecdh, auth, p256dh: ecdh.getPublicKey().toString('base64url'), authText: auth.toString('base64url') }
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest()

/** What the browser does with a message: aes128gcm (RFC 8188) with Web Push's keys (RFC 8291). */
function decrypt(body: Buffer, { ecdh, auth }: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16)
  const idlen = body[20]!
  const serverKey = body.subarray(21, 21 + idlen)
  const record = body.subarray(21 + idlen)
  const ikm = hmac(hmac(auth, ecdh.computeSecret(serverKey)), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey, Buffer.from([1])]))
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(record.subarray(-16))
  const padded = Buffer.concat([decipher.update(record.subarray(0, -16)), decipher.final()])
  // The last record ends with a 2, then any zeros of padding.
  return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8')
}

test('a message is encrypted for the browser, signed as us, and kept for a day', async () => {
  const keys = vapidKeys()
  const sender = new WebPushSender({ subject: 'mailto:no-reply@heynaija.test', publicKey: keys.PUSH_VAPID_PUBLIC_KEY, privateKey: keys.PUSH_VAPID_PRIVATE_KEY })
  assert.equal(sender.publicKey, keys.PUSH_VAPID_PUBLIC_KEY)
  const phone = browser()
  const message = { title: '@bayo replied to your post', body: '“Jollof, obviously”', url: '/p/1', tag: 'reply:1' }
  received.length = 0
  await sender.send({ endpoint: `${origin}/push/phone`, p256dh: phone.p256dh, auth: phone.authText }, message)

  const [request] = received
  assert.equal(request!.url, '/push/phone')
  assert.equal(request!.headers['content-encoding'], 'aes128gcm')
  assert.equal(request!.headers.ttl, '86400')
  assert.deepEqual(JSON.parse(decrypt(request!.body, phone)), message)
  // Only the browser can read it: the push service sees ciphertext.
  assert.ok(!request!.body.includes(Buffer.from('Jollof')))

  // VAPID (RFC 8292): a token for this push service, signed with our private key.
  const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(String(request!.headers.authorization))!
  assert.equal(key, keys.PUSH_VAPID_PUBLIC_KEY)
  const [header, claims, signature] = token!.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(claims!, 'base64url').toString()), {
    aud: origin,
    exp: JSON.parse(Buffer.from(claims!, 'base64url').toString()).exp,
    sub: 'mailto:no-reply@heynaija.test',
  })
  const point = Buffer.from(keys.PUSH_VAPID_PUBLIC_KEY, 'base64url')
  const publicKey = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
    format: 'jwk',
  })
  assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url')))
})

test('the push service’s answer decides what happens next', async () => {
  const keys = vapidKeys()
  const sender = new WebPushSender({ subject: 'mailto:no-reply@heynaija.test', publicKey: keys.PUSH_VAPID_PUBLIC_KEY, privateKey: keys.PUSH_VAPID_PRIVATE_KEY })
  const phone = browser()
  const target = { endpoint: `${origin}/push/phone`, p256dh: phone.p256dh, auth: phone.authText }
  const message = { title: 't', body: '', url: '/', tag: 'x' }
  const outcome = async (status: number) => {
    answers.push(status)
    try {
      await sender.send(target, message)
      return 'sent'
    } catch (error) {
      if (error instanceof SubscriptionGoneError) return 'gone'
      if (error instanceof PermanentPushError) return 'refused'
      return 'retry'
    }
  }
  assert.equal(await outcome(201), 'sent')
  assert.equal(await outcome(404), 'gone')
  assert.equal(await outcome(410), 'gone')
  for (const status of [400, 401, 403, 413]) assert.equal(await outcome(status), 'refused', String(status))
  for (const status of [429, 500, 503]) assert.equal(await outcome(status), 'retry', String(status))
  // Nobody there at all is worth another try too.
  await assert.rejects(sender.send({ ...target, endpoint: 'http://127.0.0.1:9/push/nobody' }, message), (error) => !(error instanceof PermanentPushError))
})
