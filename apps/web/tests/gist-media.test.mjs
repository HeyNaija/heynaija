import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GIST_ALBUM, gistMediaText, silentWav } from '../lib/gist-media.ts'

const view = { title: 'Jollof, settled', host: { id: 'h', handle: 'ada', displayName: 'Ada Obi' } }

test('the media controls show the Gist and its host, or what the member is doing', () => {
  assert.deepEqual(gistMediaText(view, { micOn: false, reconnecting: false }), { title: 'Jollof, settled', artist: 'Hosted by Ada Obi', album: GIST_ALBUM })
  assert.equal(gistMediaText(view, { micOn: true, reconnecting: false }).artist, 'Your microphone is on')
  assert.equal(gistMediaText(view, { micOn: true, reconnecting: true }).artist, 'Reconnecting…')
  assert.equal(gistMediaText({ ...view, host: { ...view.host, displayName: null } }, { micOn: false, reconnecting: false }).artist, 'Hosted by @ada')
})

test('the silent sound is a valid WAV file, long enough to count as media, and silent', () => {
  const wav = silentWav(10, 8000)
  const text = (at, n) => String.fromCharCode(...wav.subarray(at, at + n))
  const data = new DataView(wav.buffer)
  assert.equal(text(0, 4), 'RIFF')
  assert.equal(text(8, 4), 'WAVE')
  assert.equal(text(12, 4), 'fmt ')
  assert.equal(text(36, 4), 'data')
  assert.equal(data.getUint32(4, true), wav.length - 8)
  assert.equal(data.getUint16(20, true), 1)
  assert.equal(data.getUint16(22, true), 1)
  assert.equal(data.getUint32(24, true), 8000)
  assert.equal(data.getUint16(34, true), 8)
  const samples = data.getUint32(40, true)
  assert.equal(samples, 80_000)
  assert.equal(samples / data.getUint32(28, true), 10)
  assert.ok(wav.subarray(44).every((b) => b === 128))
})
