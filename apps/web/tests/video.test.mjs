import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkVideoFile, formatDuration, formatSize, pickRendition, videoFiles, VIDEO_LIMITS } from '../lib/video.ts'

const ladder = [
  { height: 240, width: 426, bytes: 1_300_000 },
  { height: 360, width: 640, bytes: 2_300_000 },
  { height: 480, width: 854, bytes: 3_600_000 },
]

test('durations read as the player shows them', () => {
  assert.equal(formatDuration(32_000), '0:32')
  assert.equal(formatDuration(60_000), '1:00')
  assert.equal(formatDuration(9_400), '0:09')
  assert.equal(formatDuration(0), '0:00')
})

test('sizes are in MB to one place, and never zero', () => {
  assert.equal(formatSize(1_300_000), '1.3 MB')
  assert.equal(formatSize(100_000), '0.1 MB')
  assert.equal(formatSize(10), '0.1 MB')
})

test('the rendition for a quality is that one, or the nearest below, or the smallest there is', () => {
  assert.equal(pickRendition(ladder, 360)?.height, 360)
  assert.equal(pickRendition(ladder, 480)?.height, 480)
  assert.equal(pickRendition(ladder, 400)?.height, 360)
  assert.equal(pickRendition(ladder.slice(1), 240)?.height, 360, 'nothing at or below: the smallest')
  assert.equal(pickRendition([], 360), null)
})

test('file URLs: the poster and the chosen MP4, under the video’s path', () => {
  assert.deepEqual(videoFiles('/media/videos/abc', ladder, 360), {
    poster: '/media/videos/abc/poster.webp',
    file: '/media/videos/abc/360.mp4',
    bytes: 2_300_000,
  })
  assert.deepEqual(videoFiles('/media/videos/abc', ladder, 360, 'https://media.example'), {
    poster: 'https://media.example/videos/abc/poster.webp',
    file: 'https://media.example/videos/abc/360.mp4',
    bytes: 2_300_000,
  })
})

test('the courtesy checks before upload: type and size (the server decides for real)', () => {
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 5_000_000 }), null)
  assert.equal(checkVideoFile({ type: 'video/quicktime', size: 5_000_000 }), null)
  assert.equal(checkVideoFile({ type: 'video/webm', size: 5_000_000 }), null)
  assert.match(checkVideoFile({ type: 'image/png', size: 100 }) ?? '', /MP4, MOV or WebM/)
  assert.match(checkVideoFile({ type: 'video/mp4', size: VIDEO_LIMITS.maxBytes + 1 }) ?? '', /100 MB/)
  assert.match(checkVideoFile({ type: 'video/mp4', size: 0 }) ?? '', /empty/)
  // A browser that cannot name the type gets to try: the server probes anyway.
  assert.equal(checkVideoFile({ type: '', size: 5_000_000, name: 'clip.mov' }), null)
  assert.match(checkVideoFile({ type: 'video/mp4', size: 100 }, 61_000) ?? '', /60 seconds/)
  assert.match(checkVideoFile({ type: 'video/mp4', size: 100 }, 1_000) ?? '', /3 seconds/)
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 100 }, undefined), null, 'duration unknown: let the server decide')
})
