import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  chooseDevice,
  createSpeakingAnnouncer,
  DEFAULT_MIC,
  deviceLabel,
  elapsedLabel,
  micFailure,
  readMicSettings,
  rmsLevel,
  smoothLevel,
  writeMicSettings,
} from '../lib/space-mic.ts'

const devs = (...ids) => ids.map((deviceId) => ({ deviceId, label: '' }))

test('saved settings round-trip, and corrupt or mistyped ones fall back to defaults', () => {
  const saved = { deviceId: 'abc', noiseSuppression: false, echoCancellation: true, autoGainControl: false }
  assert.deepEqual(readMicSettings(writeMicSettings(saved)), saved)
  assert.deepEqual(readMicSettings(null), DEFAULT_MIC)
  assert.deepEqual(readMicSettings('{nope'), DEFAULT_MIC)
  assert.deepEqual(readMicSettings('{"deviceId":5,"noiseSuppression":"yes"}'), DEFAULT_MIC)
  assert.deepEqual(readMicSettings('null'), DEFAULT_MIC)
})

test('processing is on by default', () => {
  assert.deepEqual([DEFAULT_MIC.noiseSuppression, DEFAULT_MIC.echoCancellation, DEFAULT_MIC.autoGainControl], [true, true, true])
})

test('device choice: keep the saved one while plugged in, fall back to the default when it is gone', () => {
  assert.deepEqual(chooseDevice(devs('a', 'b'), 'b'), { deviceId: 'b', fellBack: false, none: false })
  assert.deepEqual(chooseDevice(devs('a', 'b'), null), { deviceId: null, fellBack: false, none: false })
  assert.deepEqual(chooseDevice(devs('a'), 'unplugged'), { deviceId: null, fellBack: true, none: false })
  assert.deepEqual(chooseDevice([], 'a'), { deviceId: null, fellBack: false, none: true })
  assert.deepEqual(chooseDevice([], null), { deviceId: null, fellBack: false, none: true })
})

test('unlabelled devices get a numbered name', () => {
  assert.equal(deviceLabel({ deviceId: 'a', label: '' }, 1), 'Microphone 2')
  assert.equal(deviceLabel({ deviceId: 'a', label: ' Headset ' }, 0), 'Headset')
})

test('failures say what to do next, by kind', () => {
  assert.equal(micFailure({ name: 'NotAllowedError' }).kind, 'denied')
  assert.match(micFailure({ name: 'NotAllowedError' }).message, /Allow the microphone/)
  assert.equal(micFailure({ name: 'NotFoundError' }).kind, 'none')
  assert.equal(micFailure({ name: 'OverconstrainedError' }).kind, 'none')
  assert.equal(micFailure({ name: 'NotReadableError' }).kind, 'busy')
  assert.equal(micFailure(new Error('x')).kind, 'other')
  assert.equal(micFailure(undefined).kind, 'other')
})

test('level: silence is 0, loud is near 1, quiet speech still registers', () => {
  assert.equal(rmsLevel([]), 0)
  assert.equal(rmsLevel(new Float32Array(128)), 0)
  assert.ok(rmsLevel(new Float32Array(128).fill(0.9)) > 0.9)
  const quiet = rmsLevel(new Float32Array(128).fill(0.01))
  assert.ok(quiet > 0.2 && quiet < 0.6)
})

test('smoothing rises fast, falls slowly, and settles to exactly zero', () => {
  const up = smoothLevel(0, 1)
  const down = smoothLevel(1, 0)
  assert.ok(up > 0.5)
  assert.ok(down > 0.8)
  let v = 1
  for (let i = 0; i < 80; i++) v = smoothLevel(v, 0)
  assert.equal(v, 0)
})

test('speaking announcements: new speakers only, throttled, at most two names', () => {
  const name = (id) => ({ a: 'Ada', b: 'Bola', c: 'Chi' })[id] ?? null
  const a = createSpeakingAnnouncer(6000)
  assert.equal(a.next(0, ['a'], name), 'Ada is speaking.')
  // The same person carrying on is not announced again.
  assert.equal(a.next(1000, ['a'], name), null)
  // Someone new inside the quiet gap is skipped, not queued.
  assert.equal(a.next(2000, ['a', 'b'], name), null)
  assert.equal(a.next(3000, ['a', 'b'], name), null)
  // After the gap, a new start is announced.
  assert.equal(a.next(7000, ['a', 'b', 'c'], name), 'Chi is speaking.')
  const b = createSpeakingAnnouncer(1000)
  assert.equal(b.next(0, ['a', 'b'], name), 'Ada and Bola are speaking.')
  assert.equal(createSpeakingAnnouncer(0).next(0, ['a', 'b', 'c'], name), 'Several people are speaking.')
  assert.equal(createSpeakingAnnouncer(0).next(0, ['zzz'], name), null)
})

test('elapsed time reads m:ss, then h:mm:ss, and is empty before the start', () => {
  const t0 = '2026-10-30T10:00:00.000Z'
  const at = (s) => Date.parse(t0) + s * 1000
  assert.equal(elapsedLabel(null, at(5)), '')
  assert.equal(elapsedLabel(t0, at(0)), '0:00')
  assert.equal(elapsedLabel(t0, at(723)), '12:03')
  assert.equal(elapsedLabel(t0, at(3723)), '1:02:03')
  assert.equal(elapsedLabel(t0, at(-50)), '0:00')
  assert.equal(elapsedLabel('garbage', at(5)), '')
})
