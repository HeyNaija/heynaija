import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import { ARACHNID_SHIELD_URL, ArachnidShieldScanner } from './arachnid-shield.js'
import { NoScanner } from './media.service.js'
import { PhotoDnaScanner } from './photodna.js'
import { AllScanners, describeScanner, scannerFromEnv } from './scanners.js'

// Arachnid Shield as its OpenAPI document describes it (https://shield.projectarachnid.com/openapi.json),
// against a stand-in: never real material, and no call leaves this machine.

type Sent = { url: string; authorization: string; contentType: string; body: Buffer }

/** A stand-in for POST /v1/media that records what it was sent and answers with `reply`. */
const shield = (reply: () => Response) => {
  const sent: Sent[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    sent.push({ url, authorization: headers.authorization!, contentType: headers['content-type']!, body: Buffer.from(await (init.body as Blob).arrayBuffer()) })
    return reply()
  }) as typeof fetch
  return { sent, scanner: new ArachnidShieldScanner('heynaija', 's3cret', ARACHNID_SHIELD_URL, fetchFn) }
}

const scanned = (classification: string, extra: object = {}, status = 200) =>
  new Response(JSON.stringify({ size_bytes: 3, sha1_base32: 'X', sha256_hex: 'Y', classification, match_type: null, near_match_details: [], ...extra }), { status })

const png = () => sharp({ create: { width: 200, height: 200, channels: 3, background: '#2a7' } }).png().toBuffer()

let dir: string
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shield-test-'))
})
after(() => rm(dir, { recursive: true, force: true }))

test('an image goes up as it is, as the request body, with HTTP Basic and its real type', async () => {
  const { sent, scanner } = shield(() => scanned('no-known-match'))
  const image = await png()
  assert.equal(await scanner.scan(image), 'clear')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.url, 'https://shield.projectarachnid.com/v1/media')
  assert.equal(sent[0]!.authorization, `Basic ${Buffer.from('heynaija:s3cret').toString('base64')}`)
  assert.equal(sent[0]!.contentType, 'image/png', 'the format found in the file, not what the browser said')
  assert.ok(sent[0]!.body.equals(image), 'not re-encoded on the way')
})

test('only no-known-match is clear: csam, harmful-abusive-material, the test class and an unknown class all block', async () => {
  for (const classification of ['csam', 'harmful-abusive-material', 'test', 'some-class-added-later']) {
    const { scanner } = shield(() => scanned(classification, { match_type: 'exact' }))
    assert.equal(await scanner.scan(await png()), 'match', classification)
  }
})

test('no clear answer throws, so the upload waits: a wrong login, an outage, an answer without a classification', async () => {
  const replies = [
    () => new Response(JSON.stringify({ detail: 'please supply your API username and password in the Authorization header' }), { status: 401 }),
    () => new Response('bad gateway', { status: 502 }),
    () => new Response(JSON.stringify({ size_bytes: 3 }), { status: 200 }),
  ]
  for (const reply of replies) {
    const { scanner } = shield(reply)
    await assert.rejects(scanner.scan(await png()), /Arachnid Shield gave no answer/)
  }
  const { scanner } = shield(replies[0]!)
  await assert.rejects(scanner.scan(await png()), /HTTP 401: please supply your API username/, 'the reason reaches the log')
})

test('a video goes up whole, from the file, as the type it was uploaded as', async () => {
  const path = join(dir, 'clip')
  const body = Buffer.from('not really a video, the stand-in does not look')
  await writeFile(path, body)
  const { sent, scanner } = shield(() => scanned('no-known-match'))
  assert.deepEqual(await scanner.scanVideo({ path, contentType: 'video/quicktime' }), { verdict: 'clear', matchMs: null })
  assert.equal(sent[0]!.contentType, 'video/quicktime')
  assert.ok(sent[0]!.body.equals(body))
})

test('a video match says when: the first near-matching frame, in ms; an exact match of the whole file has no time', async () => {
  const path = join(dir, 'clip2')
  await writeFile(path, 'x')
  const near = shield(() =>
    scanned('csam', { match_type: 'near', near_match_details: [{ timestamp: 12.48, sha1_base32: 'A', sha256_hex: 'B', classification: 'csam' }] }),
  )
  assert.deepEqual(await near.scanner.scanVideo({ path, contentType: 'video/mp4' }), { verdict: 'match', matchMs: 12_480 })
  const exact = shield(() => scanned('harmful-abusive-material', { match_type: 'exact' }))
  assert.deepEqual(await exact.scanner.scanVideo({ path, contentType: 'video/mp4' }), { verdict: 'match', matchMs: null })
})

test('the environment picks the scanners: Shield, PhotoDNA, both, or none (fail closed)', () => {
  assert.ok(scannerFromEnv({}) instanceof NoScanner)
  assert.ok(scannerFromEnv({ ARACHNID_SHIELD_USERNAME: 'u' }) instanceof NoScanner, 'half a login is no scanner (the env check refuses it first)')
  assert.ok(scannerFromEnv({ ARACHNID_SHIELD_USERNAME: 'u', ARACHNID_SHIELD_PASSWORD: 'p' }) instanceof ArachnidShieldScanner)
  assert.ok(scannerFromEnv({ PHOTODNA_SUBSCRIPTION_KEY: 'k' }) instanceof PhotoDnaScanner)
  const both = scannerFromEnv({ ARACHNID_SHIELD_USERNAME: 'u', ARACHNID_SHIELD_PASSWORD: 'p', PHOTODNA_SUBSCRIPTION_KEY: 'k' })
  assert.ok(both instanceof AllScanners)
  assert.equal(describeScanner(both), 'Arachnid Shield + PhotoDNA')
  assert.equal(describeScanner(new NoScanner()), 'NONE (fail closed)')
})

test('together: a match from either blocks, and either one failing to answer makes the upload wait', async () => {
  const clear = shield(() => scanned('no-known-match')).scanner
  const match = shield(() => scanned('csam', { match_type: 'exact' })).scanner
  const down = shield(() => new Response('', { status: 503 })).scanner
  const image = await png()
  assert.equal(await new AllScanners([clear, clear]).scan(image), 'clear')
  assert.equal(await new AllScanners([clear, match]).scan(image), 'match')
  await assert.rejects(new AllScanners([clear, down]).scan(image), /no answer/)
})

test('together, for video: each takes what it can; unscanned only when none of them looked', async () => {
  const path = join(dir, 'clip3')
  await writeFile(path, 'x')
  const video = { path, contentType: 'video/mp4' }
  const clear = shield(() => scanned('no-known-match')).scanner
  const frames = { scan: async () => 'clear' as const, scanFrames: async () => ({ verdict: 'match' as const, matchIndex: 1 }) }
  const both = new AllScanners([clear, frames])
  assert.deepEqual(await both.scanVideo(video), { verdict: 'clear', matchMs: null }, 'only Shield takes the file')
  assert.deepEqual(await both.scanFrames([Buffer.from('a'), Buffer.from('b')]), { verdict: 'match', matchIndex: 1 }, 'only the frame scanner takes frames')
  assert.deepEqual(await new AllScanners([frames]).scanVideo(video), { verdict: 'unscanned', matchMs: null })
})
