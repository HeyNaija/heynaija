import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import {
  checkLimits,
  extractFrames,
  extractPoster,
  FFMPEG_SAFETY,
  parseProbe,
  parseShowinfo,
  type Probe,
  probe,
  renditionPlan,
  sceneBudget,
  transcode,
  transcodeArgs,
} from './ffmpeg.js'
import { DEFAULT_VIDEO_CONFIG as cfg } from './video-config.js'

const ffprobeJson = (over: { width?: number; height?: number; rotation?: number; duration?: string; audio?: boolean; format?: string; noVideo?: boolean } = {}) => ({
  format: { format_name: over.format ?? 'mov,mp4,m4a,3gp,3g2,mj2', duration: over.duration ?? '12.5' },
  streams: [
    ...(over.noVideo
      ? []
      : [
          {
            codec_type: 'video',
            codec_name: 'h264',
            width: over.width ?? 1920,
            height: over.height ?? 1080,
            avg_frame_rate: '30000/1001',
            ...(over.rotation === undefined ? {} : { side_data_list: [{ side_data_type: 'Display Matrix', rotation: over.rotation }] }),
          },
        ]),
    ...(over.audio === false ? [] : [{ codec_type: 'audio', codec_name: 'aac' }]),
  ],
})

const probed = (over: Partial<Probe> = {}): Probe => ({
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationMs: 12_500,
  width: 1920,
  height: 1080,
  fps: 29.97,
  hasAudio: true,
  videoCodec: 'h264',
  ...over,
})

test('parseProbe reads the size, length, frame rate and audio from ffprobe', () => {
  const p = parseProbe(ffprobeJson())!
  assert.deepEqual([p.width, p.height, p.durationMs, p.hasAudio, p.videoCodec], [1920, 1080, 12_500, true, 'h264'])
  assert.ok(Math.abs(p.fps - 29.97) < 0.01)
  assert.equal(parseProbe(ffprobeJson({ audio: false }))!.hasAudio, false)
})

test('parseProbe gives the size as shown: a phone clip stored sideways is upright', () => {
  const p = parseProbe(ffprobeJson({ width: 1920, height: 1080, rotation: -90 }))!
  assert.deepEqual([p.width, p.height], [1080, 1920])
  const q = parseProbe(ffprobeJson({ width: 1920, height: 1080, rotation: 180 }))!
  assert.deepEqual([q.width, q.height], [1920, 1080])
})

test('parseProbe: no video stream, an unknown container or a missing length is not a usable video', () => {
  assert.equal(parseProbe(ffprobeJson({ noVideo: true })), null)
  assert.equal(parseProbe(ffprobeJson({ format: 'mp3' })), null)
  assert.equal(parseProbe(ffprobeJson({ duration: 'N/A' })), null)
  assert.equal(parseProbe(null), null)
  assert.equal(parseProbe({ format: 5 }), null)
  assert.ok(parseProbe(ffprobeJson({ format: 'matroska,webm' })))
})

test('checkLimits: the ADR limits, decided server-side', () => {
  assert.equal(checkLimits(probed(), 50_000_000, cfg), null)
  assert.equal(checkLimits(null, 1000, cfg), 'not_a_video')
  assert.equal(checkLimits(probed({ durationMs: 60_000 }), 1000, cfg), null, 'exactly the limit is allowed')
  assert.equal(checkLimits(probed({ durationMs: 60_001 }), 1000, cfg), 'too_long')
  assert.equal(checkLimits(probed({ durationMs: 2_900 }), 1000, cfg), 'too_short')
  assert.equal(checkLimits(probed(), cfg.maxBytes + 1, cfg), 'too_large')
  assert.equal(checkLimits(probed({ width: 2160, height: 3840 }), 1000, cfg), 'too_big_picture')
  assert.equal(checkLimits(probed({ width: 1080, height: 1920 }), 1000, cfg), null, 'a portrait 1080p clip is fine')
})

test('renditionPlan: the short edge is 240, 360 and 480, never enlarged, always even', () => {
  assert.deepEqual(
    renditionPlan(probed()).map((r) => [r.label, r.width, r.height]),
    [[240, 426, 240], [360, 640, 360], [480, 854, 480]],
  )
  assert.deepEqual(
    renditionPlan(probed({ width: 1080, height: 1920 })).map((r) => [r.label, r.width, r.height]),
    [[240, 240, 426], [360, 360, 640], [480, 480, 854]],
    'a portrait clip does not become a 1920 pixel wide file',
  )
  assert.deepEqual(renditionPlan(probed({ width: 640, height: 360 })).map((r) => r.label), [240, 360])
  // Smaller than the whole ladder: one rendition at its own size.
  assert.deepEqual(renditionPlan(probed({ width: 200, height: 150 })).map((r) => [r.label, r.width, r.height]), [[150, 200, 150]])
})

test('transcodeArgs: the invocation, with the safety flags and the ADR ladder settings', () => {
  const args = transcodeArgs('/in/o.mp4', ['/out/240.mp4', '/out/360.mp4', '/out/480.mp4'], probed({ fps: 60 }), cfg)
  const line = args.join(' ')
  // Untrusted input: no network protocols, no stdin, no metadata carried over.
  assert.ok(line.includes(`-protocol_whitelist ${FFMPEG_SAFETY.protocolWhitelist}`))
  assert.ok(args.indexOf('-protocol_whitelist') < args.indexOf('-i'), 'the whitelist applies to the input')
  assert.ok(args.includes('-nostdin'))
  assert.equal(args.filter((a) => a === '-map_metadata').length, 3)
  assert.equal(args.filter((a) => a === '+faststart').length, 3)
  for (const out of ['/out/240.mp4', '/out/360.mp4', '/out/480.mp4']) assert.equal(args.filter((a) => a === out).length, 1)
  assert.ok(line.includes('libx264') && line.includes('yuv420p') && line.includes('-profile:v main'))
  assert.ok(line.includes('-b:v 300k') && line.includes('-b:v 550k') && line.includes('-b:v 900k'))
  assert.ok(line.includes('-b:a 48k') && line.includes('-b:a 64k'))
  assert.ok(line.includes('fps=30'), 'a 60 fps source is capped to 30')
  // Never trust the probe's duration alone: stop encoding past the limit.
  assert.equal(args[args.indexOf('-t') + 1], String(cfg.maxSeconds + 1))
})

test('transcodeArgs: no audio track in, none out; a 24 fps source is not resampled', () => {
  const args = transcodeArgs('/in', ['/a.mp4', '/b.mp4', '/c.mp4'], probed({ hasAudio: false, fps: 24 }), cfg)
  assert.ok(args.includes('-an'))
  assert.ok(!args.includes('-c:a'))
  assert.ok(!args.join(' ').includes('fps=30'))
})

test('transcodeArgs: needs one output per rendition', () => {
  assert.throws(() => transcodeArgs('/in', ['/only.mp4'], probed(), cfg), /one output per rendition/)
})

test('sceneBudget keeps the whole sample within 80 frames', () => {
  assert.equal(sceneBudget(10), 20)
  assert.equal(sceneBudget(60), 19) // 60 frames a second and the last leave room for 19 more in 80
  assert.equal(sceneBudget(79), 0)
  assert.ok(60 + 1 + sceneBudget(60) <= 80)
})

test('parseShowinfo reads frame times from ffmpeg’s log', () => {
  const log = [
    '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  12345 pts_time:1.37167 duration: 1',
    'noise',
    '[Parsed_showinfo_1 @ 0x1] n:   1 pts: 999999 pts_time:11.1111 duration: 1',
  ].join('\n')
  assert.deepEqual(parseShowinfo(log), [1372, 11_111])
})

// --- The real ffmpeg, on tiny generated clips. Skipped, with the reason, where it is not installed. ---

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const skip = !hasFfmpeg && 'ffmpeg and ffprobe are not installed here; the invocation is still covered by the argument tests above'

let dir: string
const clip = (name: string, size: string, seconds: number, opts: { audio?: boolean; rate?: number } = {}) => {
  const path = join(dir, name)
  execFileSync(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${opts.rate ?? 30}:duration=${seconds}`,
      ...(opts.audio === false ? [] : ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:a', 'aac']),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-metadata', 'location=+06.5244+003.3792/', path,
    ],
    { stdio: 'ignore' },
  )
  return path
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ffmpeg-test-'))
})
after(() => rm(dir, { recursive: true, force: true }))

test('probe, transcode, poster and frame sampling on a generated clip', { skip, timeout: 120_000 }, async () => {
  const input = clip('landscape.mp4', '854x480', 4, { rate: 50 })
  const p = (await probe(input))!
  assert.deepEqual([p.width, p.height, p.hasAudio], [854, 480, true])
  assert.ok(Math.abs(p.durationMs - 4000) < 200, String(p.durationMs))
  assert.equal(checkLimits(p, (await stat(input)).size, cfg), null)

  const plan = renditionPlan(p)
  const outs = plan.map((r) => join(dir, `${r.label}.mp4`))
  await transcode(input, outs, p, cfg)
  for (const [i, r] of plan.entries()) {
    const o = (await probe(outs[i]!))!
    assert.deepEqual([o.width, o.height], [r.width, r.height], `rendition ${r.label}`)
    assert.equal(o.videoCodec, 'h264')
    assert.ok(o.fps <= 30.01, `fps capped: ${o.fps}`)
    assert.ok(o.hasAudio)
    assert.ok(Math.abs(o.durationMs - 4000) < 300)
    // `location` metadata is dropped, and +faststart puts the moov atom first.
    const raw = await readFile(outs[i]!)
    assert.ok(!raw.includes('+06.5244'), 'location metadata was copied')
    assert.ok(raw.indexOf('moov') < raw.indexOf('mdat'), 'not faststart')
  }

  const poster = await extractPoster(input, join(dir, 'poster.jpg'), p.durationMs)
  const meta = await sharp(poster).metadata()
  assert.ok(Math.max(meta.width!, meta.height!) <= 640 && meta.width! > 100)

  const frames = await extractFrames(input, join(dir, 'frames'), p.durationMs)
  assert.ok(frames.length >= 4 && frames.length <= 80, `frames: ${frames.length}`)
  assert.deepEqual([...frames].sort((a, b) => a.ms - b.ms).map((f) => f.ms), frames.map((f) => f.ms), 'in time order')
  assert.ok(frames.every((f) => f.jpeg.length > 100))
})

test('a clip without audio, and a portrait clip', { skip, timeout: 120_000 }, async () => {
  const input = clip('portrait.mp4', '480x854', 3, { audio: false })
  const p = (await probe(input))!
  assert.equal(p.hasAudio, false)
  const plan = renditionPlan(p)
  assert.deepEqual(plan.map((r) => r.label), [240, 360, 480])
  const outs = plan.map((r) => join(dir, `p${r.label}.mp4`))
  await transcode(input, outs, p, cfg)
  const o = (await probe(outs[0]!))!
  assert.deepEqual([o.width, o.height, o.hasAudio], [240, 428, false]) // 480x854 at 240 wide is 427 high, rounded to the even 428
})

test('probe says null for a file that is not a video, rather than throwing', { skip }, async () => {
  const { writeFile } = await import('node:fs/promises')
  const junk = join(dir, 'junk.mp4')
  await writeFile(junk, Buffer.from('this is not a video'))
  assert.equal(await probe(junk), null)
})
