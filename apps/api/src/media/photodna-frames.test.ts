import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { NoScanner } from './media.service.js'
import { PHOTODNA_MATCH_URL, PhotoDnaScanner } from './photodna.js'

// Video frames (ADR 0019 section 4.1): each sampled frame goes through the same Match call as an image.

const jpegFrame = (red: number) => sharp({ create: { width: 320, height: 200, channels: 3, background: { r: red, g: 0, b: 0 } } }).jpeg().toBuffer()

const answer = (IsMatch: boolean, status = 200, code = 3000) =>
  new Response(JSON.stringify({ Status: { Code: code, Description: 'x' }, IsMatch }), { status })

test('scanFrames: no frame matching is clear, and each frame is sent', async () => {
  let calls = 0
  const fetchFn = (async () => (calls++, answer(false))) as typeof fetch
  const frames = await Promise.all([10, 20, 30].map(jpegFrame))
  const result = await new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, fetchFn).scanFrames(frames)
  assert.deepEqual(result, { verdict: 'clear', matchIndex: null })
  assert.equal(calls, 3)
})

test('scanFrames: a match on any frame blocks the video and says which frame', async () => {
  const frames = await Promise.all([10, 20, 30, 40].map(jpegFrame))
  // Answer by the red of the frame that was sent, since frames go two at a time.
  const fetchFn = (async (_url: string, init: RequestInit) => {
    const red = (await sharp(Buffer.from(init.body as Uint8Array)).stats()).channels[0]!.mean
    return answer(red > 25 && red < 35)
  }) as typeof fetch
  const result = await new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, fetchFn).scanFrames(frames)
  assert.deepEqual(result, { verdict: 'match', matchIndex: 2 })
})

test('scanFrames: no clear answer (a 429, say) throws, so the video waits and is retried', async () => {
  const fetchFn = (async () => answer(false, 429, 4290)) as typeof fetch
  await assert.rejects(
    async () => new PhotoDnaScanner('KEY', PHOTODNA_MATCH_URL, fetchFn).scanFrames([await jpegFrame(5)]),
    /PhotoDNA gave no answer/,
  )
})

test('NoScanner is the fail-closed stand-in for video: it never says clear', async () => {
  assert.deepEqual(await new NoScanner().scanFrames([Buffer.from('x')]), { verdict: 'unscanned', matchIndex: null })
})
