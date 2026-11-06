import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import {
  checkLimits,
  DurationMismatch,
  FfmpegTimeout,
  expiredDeadline,
  extractFrames,
  frameArgs,
  stillArgs,
  extractPoster,
  jobTimeoutMs,
  MAX_SAMPLE_FRAMES,
  newDeadline,
  parseProbe,
  parseShowinfo,
  type Probe,
  probe,
  runTimeoutMs,
  sampleStep,
  sceneBudget,
} from './ffmpeg.js'
import { encodeHls, hlsLadder } from './hls.js'
import { DEFAULT_VIDEO_CONFIG as cfg, FRAME_SCAN_MAX_SECONDS } from './video-config.js'

const ffprobeJson = (over: { width?: number; height?: number; rotation?: number; duration?: string; audio?: boolean; format?: string; noVideo?: boolean; videoStreams?: number } = {}) => ({
  format: { format_name: over.format ?? 'mov,mp4,m4a,3gp,3g2,mj2', duration: over.duration ?? '12.5' },
  streams: [
    ...(over.noVideo
      ? []
      : Array.from({ length: over.videoStreams ?? 1 }, () => ({
            codec_type: 'video',
            codec_name: 'h264',
            width: over.width ?? 1920,
            height: over.height ?? 1080,
            avg_frame_rate: '30000/1001',
            ...(over.rotation === undefined ? {} : { side_data_list: [{ side_data_type: 'Display Matrix', rotation: over.rotation }] }),
          }))),
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
  hdr: false,
  ...over,
})

test('parseProbe marks HDR (PQ or HLG) so it can be tone-mapped', () => {
  const withTransfer = (color_transfer: string) => {
    const json = ffprobeJson() as { streams: Record<string, unknown>[] }
    json.streams[0] = { ...json.streams[0], color_transfer }
    return parseProbe(json)!.hdr
  }
  assert.equal(withTransfer('arib-std-b67'), true, 'HLG, as iPhones record')
  assert.equal(withTransfer('smpte2084'), true, 'PQ')
  assert.equal(withTransfer('bt709'), false)
  assert.equal(parseProbe(ffprobeJson())!.hdr, false)
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
  assert.equal(checkLimits(probed({ durationMs: 180_000 }), 1000, cfg), null, 'exactly the limit, 3 minutes, is allowed')
  assert.equal(checkLimits(probed({ durationMs: 180_001 }), 1000, cfg), 'too_long')
  assert.equal(checkLimits(probed({ durationMs: 2_900 }), 1000, cfg), 'too_short')
  assert.equal(checkLimits(probed(), 1024 * 1024 * 1024, cfg), null, '1 GB is allowed')
  assert.equal(checkLimits(probed(), cfg.maxBytes + 1, cfg), 'too_large')
  assert.equal(checkLimits(probed({ width: 2160, height: 3840 }), 1000, cfg), null, 'a portrait 4K clip is fine')
  assert.equal(checkLimits(probed({ width: 4096, height: 2160 }), 1000, cfg), 'too_big_picture', 'over 3840 on the long side')
})

test('time limits follow the clip’s length: 5 minutes and 4 times it per run, and Shield’s 5 minutes on top for the job', () => {
  assert.equal(runTimeoutMs(180_000), 17 * 60_000, 'a 3-minute clip gets 17 minutes (ADR 0021 section 5)')
  assert.equal(runTimeoutMs(3_000), 5 * 60_000 + 12_000)
  assert.equal(jobTimeoutMs(180_000), 22 * 60_000)
  assert.equal(jobTimeoutMs(60_000), runTimeoutMs(60_000) + 5 * 60_000)
  const deadline = newDeadline()
  assert.ok(Math.abs(deadline.at - Date.now() - jobTimeoutMs(cfg.maxSeconds * 1000)) < 1000, 'by default, the longest clip’s')
})

test('the sampled frames spread over the whole clip: one a second up to 78 seconds, then one every 2 or 3', () => {
  assert.equal(FRAME_SCAN_MAX_SECONDS, MAX_SAMPLE_FRAMES - 2, 'one a second and the last, in 80')
  assert.deepEqual([4_000, 78_000, 78_001, 156_000, 156_001, 180_000].map(sampleStep), [1, 1, 2, 2, 3, 3])
  for (const ms of [12_000, 78_000, 100_000, 156_000, 180_000, 181_000]) {
    // One frame every step over the clip, and the last, fit in the 80.
    assert.ok(Math.ceil(ms / 1000 / sampleStep(ms)) + 1 + 1 <= MAX_SAMPLE_FRAMES, String(ms))
  }
  const at = (args: string[]) => args[args.indexOf('-vf') + 1]!
  assert.match(at(frameArgs('/in', '/f', 12_500, 180).seconds), /^fps=1\/1,/)
  assert.match(at(frameArgs('/in', '/f', 100_000, 180).seconds), /^fps=1\/2,/)
  assert.match(at(frameArgs('/in', '/f', 180_000, 180).seconds), /^fps=1\/3,/)
})

test('parseProbe: more than one video stream is refused, so the stream scanned is the stream published', () => {
  assert.equal(parseProbe(ffprobeJson({ videoStreams: 2 })), null)
  assert.ok(parseProbe(ffprobeJson({ videoStreams: 1 })))
})

test('every read of the input maps the first video stream: the scan, the poster and the encode see the same one', () => {
  const frames = frameArgs('/in/o.mp4', '/work/frames', 12_500, 60)
  for (const [name, args] of Object.entries(frames)) {
    const i = args.indexOf('-map')
    assert.ok(i > args.indexOf('-i'), `${name} maps after its input`)
    assert.equal(args[i + 1], '0:v:0', name)
  }
  const still = stillArgs('/in/o.mp4', 1000, '/work/p.jpg', 'scale=640:640')
  assert.equal(still[still.indexOf('-map') + 1], '0:v:0')
  // The encode's: hls.test.ts.
})

test('the scan reads at most the limit plus a second, whatever the container claims', () => {
  const frames = frameArgs('/in/o.mp4', '/work/frames', 4_000, 60)
  assert.equal(frames.seconds[frames.seconds.indexOf('-t') + 1], '61')
  assert.equal(frames.scenes[frames.scenes.indexOf('-t') + 1], '61')
})

test('checkLimits: a frame rate over 60, or more frames than the limit allows at 60 a second, is refused', () => {
  assert.equal(checkLimits(probed({ fps: 60 }), 1000, cfg), null)
  assert.equal(checkLimits(probed({ fps: 120 }), 1000, cfg), 'too_long')
  assert.equal(checkLimits(probed({ fps: 30, frameCount: cfg.maxSeconds * 60 + 1 }), 1000, cfg), 'too_long')
  assert.equal(checkLimits(probed({ fps: 30, frameCount: cfg.maxSeconds * 60 }), 1000, cfg), null)
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

/** Encodes into a fresh folder per quality, as the worker does, and gives each quality's folder. */
const encoded = async (input: string, p: Probe, name: string) => {
  const out = join(dir, name)
  for (const r of hlsLadder(p)) await mkdir(join(out, String(r.label)), { recursive: true })
  await encodeHls(input, out, p, cfg.maxSeconds, newDeadline())
  return out
}

test('probe, HLS encode, poster and frame sampling on a generated clip', { skip, timeout: 120_000 }, async () => {
  const input = clip('landscape.mp4', '854x480', 4, { rate: 50 })
  const p = (await probe(input))!
  assert.deepEqual([p.width, p.height, p.hasAudio], [854, 480, true])
  assert.ok(Math.abs(p.durationMs - 4000) < 200, String(p.durationMs))
  assert.equal(checkLimits(p, (await stat(input)).size, cfg), null)

  const out = await encoded(input, p, 'landscape-hls')
  for (const r of hlsLadder(p)) {
    const folder = join(out, String(r.label))
    const files = await readdir(folder)
    // The init file and a piece together are an MP4 ffprobe can read.
    const init = files.find((f) => /^init_\d+\.mp4$/.test(f))!
    const joined = join(dir, `joined-${r.label}.mp4`)
    await writeFile(joined, Buffer.concat([await readFile(join(folder, init)), await readFile(join(folder, 'piece-000.m4s'))]))
    const o = (await probe(joined))!
    assert.deepEqual([o.width, o.height], [r.width, r.height], `quality ${r.label}`)
    assert.equal(o.videoCodec, 'h264')
    assert.ok(o.fps <= 30.01, `fps capped: ${o.fps}`)
    assert.ok(o.hasAudio)
    // `location` metadata is dropped.
    for (const f of files) assert.ok(!(await readFile(join(folder, f))).includes('+06.5244'), `location metadata was copied into ${f}`)
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
  assert.deepEqual(hlsLadder(p).map((r) => r.label), [240, 360, 480])
  const out = await encoded(input, p, 'portrait-hls')
  const playlist = await readFile(join(out, '240', 'index.m3u8'), 'utf8')
  assert.match(playlist, /#EXT-X-MAP:URI="init_\d+\.mp4"/)
  assert.match(playlist, /^piece-000\.m4s$/m)
  assert.match(await readFile(join(out, 'master.m3u8'), 'utf8'), /RESOLUTION=240x428/) // 480x854 at 240 wide is 427 high, rounded to the even 428
})

test('a clip over 78 seconds is sampled across its whole length, still within the 80 frames', { skip, timeout: 120_000 }, async () => {
  const input = clip('long.mp4', '160x90', 100, { audio: false, rate: 5 })
  const p = (await probe(input))!
  const frames = await extractFrames(input, join(dir, 'long-frames'), p.durationMs, cfg.maxSeconds)
  assert.ok(frames.length <= MAX_SAMPLE_FRAMES, `frames: ${frames.length}`)
  const evenly = frames.filter((f) => f.ms % 2000 === 0)
  assert.ok(evenly.length >= 50, `one every 2 seconds: ${evenly.length}`)
  assert.ok(frames.at(-1)!.ms >= 98_000, `the end is covered: ${frames.at(-1)!.ms}`)
})

test('probe says null for a file that is not a video, rather than throwing', { skip }, async () => {
  const { writeFile } = await import('node:fs/promises')
  const junk = join(dir, 'junk.mp4')
  await writeFile(junk, Buffer.from('this is not a video'))
  assert.equal(await probe(junk), null)
})

test('an expired deadline stops a run before it starts, as a timeout', { skip }, async () => {
  const input = clip('deadline.mp4', '320x240', 3)
  await assert.rejects(() => probe(input, expiredDeadline()), FfmpegTimeout)
})

// A WebM that says it is 4 seconds long and holds 30: the container's claim is the Segment's Duration float.
const lyingWebm = (name: string, realSeconds: number, claimSeconds: number) => {
  const path = join(dir, name)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=10:duration=${realSeconds}`, '-c:v', 'libvpx', '-b:v', '50k', '-an', path], { stdio: 'ignore' })
  return { path, patch: async () => {
    const d = await readFile(path)
    for (let i = d.indexOf(Buffer.from([0x44, 0x89])); i >= 0; i = d.indexOf(Buffer.from([0x44, 0x89]), i + 1)) {
      if (d[i + 2] === 0x88) d.writeDoubleBE(claimSeconds * 1000, i + 3)
      else if (d[i + 2] === 0x84) d.writeFloatBE(claimSeconds * 1000, i + 3)
      else continue
      const out = join(dir, `lie-${name}`)
      await (await import('node:fs/promises')).writeFile(out, d)
      return out
    }
    throw new Error('no Duration element found to patch')
  } }
}
const hasVp8 = (() => {
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders']).toString().includes('libvpx ')
  } catch {
    return false
  }
})()
const skipVp8 = skip || (!hasVp8 && 'this ffmpeg has no libvpx encoder, so the lying WebM cannot be generated')

test('a WebM that claims 4 s and holds 30 is refused by the sampler, not scanned for 5 s and published for 30', { skip: skipVp8, timeout: 120_000 }, async () => {
  const lie = await lyingWebm('lie.webm', 30, 4).patch()
  const p = (await probe(lie))!
  assert.ok(p.durationMs < 5000, `the container claims ${p.durationMs} ms`)
  assert.equal(checkLimits(p, 1000, { ...cfg, minSeconds: 0 }), null, 'the probe alone believes it')
  await assert.rejects(() => extractFrames(lie, join(dir, 'lie-frames'), p.durationMs), DurationMismatch)
})

test('a file with two video streams, default on the second, is refused at the probe', { skip, timeout: 120_000 }, async () => {
  const a = clip('a.mp4', '320x240', 3, { audio: false })
  const b = clip('b.mp4', '320x240', 3, { audio: false })
  const two = join(dir, 'two.mkv')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', a, '-i', b, '-map', '0:v', '-map', '1:v', '-c', 'copy', '-disposition:v:0', '0', '-disposition:v:1', 'default', two], { stdio: 'ignore' })
  assert.equal(await probe(two), null)
})
