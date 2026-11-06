import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ASK_ABOVE_BYTES, checkVideoFile, DEFAULT_VIDEO_LIMITS, formatDuration, formatSize, pickRendition, rejectionText, sendingQuestion, videoFiles } from '../lib/video.ts'

const at = (path) => `https://media.example/videos/abc/${path}`
const ladder = [
  { height: 240, width: 426, bytes: 1_300_000, playlistUrl: at('hls/240/index.m3u8') },
  { height: 360, width: 640, bytes: 2_300_000, playlistUrl: at('hls/360/index.m3u8') },
  { height: 480, width: 854, bytes: 3_600_000, playlistUrl: at('hls/480/index.m3u8') },
  { height: 720, width: 1280, bytes: 6_800_000, playlistUrl: at('hls/720/index.m3u8') },
]
const video = { posterUrl: at('poster.webp'), playlists: { all: at('hls/master.m3u8'), upTo480: at('hls/master-480.m3u8') }, renditions: ladder }

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

test('the playlist by data setting (ADR 0021 section 7): 240p alone when saving data, up to 480p on auto, all on full', () => {
  assert.deepEqual(videoFiles(video, 'saver'), { poster: at('poster.webp'), playlist: at('hls/240/index.m3u8'), bytes: 1_300_000 })
  assert.equal(videoFiles(video, 'auto').playlist, at('hls/master-480.m3u8'))
  assert.equal(videoFiles(video, 'full').playlist, at('hls/master.m3u8'))
  const tiny = { ...video, renditions: [{ height: 180, width: 320, bytes: 400_000, playlistUrl: at('hls/180/index.m3u8') }] }
  assert.equal(videoFiles(tiny, 'saver').playlist, at('hls/180/index.m3u8'), 'a clip under 240 plays the one it has')
  assert.equal(videoFiles({ ...video, renditions: [] }, 'auto').playlist, null)
})

test('the composer asks before sending a file over 200 MB, and every file when the member is saving data', () => {
  assert.equal(sendingQuestion(ASK_ABOVE_BYTES, false), null, '200 MB exactly goes at once')
  assert.equal(sendingQuestion(50_000_000, false), null)
  assert.equal(sendingQuestion(512_300_000, false), 'This video is 512.3 MB, so sending it uses that much data. Send it?')
  assert.equal(sendingQuestion(4_200_000, true), 'You are saving data, and this video is 4.2 MB. Send it?')
})

test('the courtesy checks before upload: type and size (the server decides for real)', () => {
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 5_000_000 }), null)
  assert.equal(checkVideoFile({ type: 'video/quicktime', size: 5_000_000 }), null)
  assert.equal(checkVideoFile({ type: 'video/webm', size: 5_000_000 }), null)
  assert.match(checkVideoFile({ type: 'image/png', size: 100 }) ?? '', /MP4, MOV or WebM/)
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 900_000_000 }), null, 'a 900 MB 4K clip is within 1 GB')
  assert.match(checkVideoFile({ type: 'video/mp4', size: DEFAULT_VIDEO_LIMITS.maxBytes + 1 }) ?? '', /1024 MB/)
  assert.match(checkVideoFile({ type: 'video/mp4', size: 0 }) ?? '', /empty/)
  // A browser that cannot name the type gets to try: the server probes anyway.
  assert.equal(checkVideoFile({ type: '', size: 5_000_000, name: 'clip.mov' }), null)
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 100 }, 179_000), null, 'up to 3 minutes')
  assert.match(checkVideoFile({ type: 'video/mp4', size: 100 }, 181_000) ?? '', /180 seconds/)
  assert.match(checkVideoFile({ type: 'video/mp4', size: 100 }, 1_000) ?? '', /3 seconds/)
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 100 }, undefined), null, 'duration unknown: let the server decide')
})

test('the checks and the refusals use the limits the API sends, not numbers of their own', () => {
  const limits = { maxBytes: 50 * 1024 * 1024, maxSeconds: 30, minSeconds: 2, maxEdge: 1280 }
  assert.match(checkVideoFile({ type: 'video/mp4', size: 60 * 1024 * 1024 }, undefined, limits) ?? '', /The limit is 50 MB/)
  assert.match(checkVideoFile({ type: 'video/mp4', size: 100 }, 45_000, limits) ?? '', /The limit is 30 seconds/)
  assert.equal(checkVideoFile({ type: 'video/mp4', size: 100 }, 61_000, { ...limits, maxSeconds: 78 }), null, 'a longer limit lets a longer clip through')
  assert.match(checkVideoFile({ type: 'video/mp4', size: 100 }, 1_500, limits) ?? '', /The least is 2 seconds/)
  assert.match(rejectionText('too_long', limits), /30 seconds/)
  assert.match(rejectionText('too_short', limits), /2 seconds/)
  assert.match(rejectionText('too_large', limits), /50 MB/)
  assert.match(rejectionText('too_big_picture', limits), /1280 pixels/)
  assert.match(rejectionText('too_big_picture', DEFAULT_VIDEO_LIMITS), /bigger than 4K/)
  assert.match(rejectionText('too_big_picture', { ...limits, maxEdge: 1920 }), /bigger than 1080p/)
  assert.equal(rejectionText(null, limits), 'That video could not be used.')
})
