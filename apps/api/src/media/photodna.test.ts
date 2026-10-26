import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { framesToScan, MAX_SCANNED_FRAMES, PHOTODNA_MATCH_URL, PhotoDnaScanner } from './photodna.js'

const still = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#2a7' } }).png().toBuffer()

// Red rises frame by frame, so a frame can be told apart once it is a JPEG; green
// alternates, so no two neighbouring frames are alike enough for the GIF encoder to merge.
const animation = async (frames: number) =>
  sharp(
    await Promise.all(
      Array.from({ length: frames }, (_, i) =>
        sharp({ create: { width: 200, height: 200, channels: 3, background: { r: i * 5, g: i % 2 ? 255 : 0, b: 0 } } }).png().toBuffer(),
      ),
    ),
    { join: { animated: true } },
  )
    .gif()
    .toBuffer()

const redOf = async (jpeg: Buffer) => (await sharp(jpeg).stats()).channels[0]!.mean

test('a still image is sent once, as a JPEG within the service’s sizes', async () => {
  const [small] = await framesToScan(await still(100, 60))
  const meta = await sharp(small!).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(Math.min(meta.width!, meta.height!), 160)

  const [large] = await framesToScan(await still(5000, 3000))
  assert.equal((await sharp(large!).metadata()).width, 2048)
})

test('an animation is sent frame by frame, or as an even spread of a long one starting at the first', async () => {
  assert.equal((await framesToScan(await animation(3))).length, 3)

  const frames = await framesToScan(await animation(50))
  assert.equal(frames.length, MAX_SCANNED_FRAMES)
  assert.ok((await redOf(frames[0]!)) < 2, 'the first frame is always scanned')
  assert.ok((await redOf(frames.at(-1)!)) > 190, 'and so is the last')
})

/** A stand-in for PhotoDNA, answering each request in turn. */
const photoDna = (answers: { status?: number; body: unknown }[]) => {
  const calls: { url: string; key: string }[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, key: (init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']! })
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }) as typeof fetch
  return { calls, fetchFn }
}
const ok = (IsMatch: boolean) => ({ body: { Status: { Code: 3000, Description: 'OK' }, IsMatch } })

test('an image is clear only when no frame matches', async () => {
  const clear = photoDna([ok(false)])
  assert.equal(await new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, clear.fetchFn).scan(await animation(3)), 'clear')
  assert.deepEqual(clear.calls, Array(3).fill({ url: `${PHOTODNA_MATCH_URL}?enhance=false`, key: 'KEY' }))

  const second = photoDna([ok(false), ok(true)])
  assert.equal(await new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, second.fetchFn).scan(await animation(3)), 'match')
  // It stops at the first match.
  assert.equal(second.calls.length, 2)
})

test('anything but a clear answer throws, so the upload waits instead of being published', async () => {
  const scan = (answer: { status?: number; body: unknown }) =>
    new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, photoDna([answer]).fetchFn).scan(Buffer.from([]))
  const image = await still(400, 300)
  for (const answer of [
    { status: 401, body: { message: 'Access denied due to invalid subscription key' } },
    { status: 429, body: { message: 'Rate limit is exceeded' } },
    { body: { Status: { Code: 3002, Description: 'Invalid image' } } },
    { body: { Status: { Code: 3000 } } },
    { body: 'not json' },
  ]) {
    await assert.rejects(new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, photoDna([answer]).fetchFn).scan(image), /PhotoDNA gave no answer/)
  }
  // An unreadable file is refused before anything is sent.
  await assert.rejects(scan(ok(false)))
})
