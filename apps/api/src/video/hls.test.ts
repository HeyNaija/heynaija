import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FFMPEG, FFMPEG_SAFETY, type Probe, probe } from './ffmpeg.js'
import { hlsArgs, hlsLadder, toneMap, upTo480 } from './hls.js'

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

const filterOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1]!

test('the ladder: 240p to 720p for 1080p and 4K, never enlarged, portrait kept portrait', () => {
  assert.deepEqual(hlsLadder({ width: 1920, height: 1080 }).map((r) => [r.label, r.width, r.height]), [[240, 426, 240], [360, 640, 360], [480, 854, 480], [720, 1280, 720]])
  assert.deepEqual(hlsLadder({ width: 3840, height: 2160 }).map((r) => r.label), [240, 360, 480, 720], '4K comes out at 720p at most')
  assert.deepEqual(hlsLadder({ width: 1080, height: 1920 }).map((r) => [r.width, r.height]).at(-1), [720, 1280], 'a phone held upright')
  assert.deepEqual(hlsLadder({ width: 640, height: 360 }).map((r) => r.label), [240, 360], 'nothing above the original')
  assert.deepEqual(hlsLadder({ width: 320, height: 180 }).map((r) => [r.label, r.width, r.height]), [[180, 320, 180]], 'smaller than the ladder: one at its own size')
})

test('one pass: scaled down once to 720p, then split per quality; 30 fps at most; HDR tone-mapped at 720p, not 4K', () => {
  const plain = filterOf(hlsArgs('/in', '/out', probed(), 180))
  assert.match(plain, /^\[0:v:0\]scale=1280:720:flags=bicubic,split=4\[s0\]\[s1\]\[s2\]\[s3\];/)
  assert.ok(!plain.includes('fps=30') && !plain.includes('zscale'))
  const exact = filterOf(hlsArgs('/in', '/out', probed({ width: 1280, height: 720 }), 180))
  assert.match(exact, /^\[0:v:0\]split=4/, 'already the largest size: no extra scale')
  const fast = filterOf(hlsArgs('/in', '/out', probed({ fps: 59.94 }), 180))
  assert.ok(fast.startsWith('[0:v:0]fps=30,'))
  const hdr = filterOf(hlsArgs('/in', '/out', probed({ hdr: true, width: 3840, height: 2160, fps: 60 }), 180))
  assert.ok(hdr.startsWith(`[0:v:0]fps=30,${toneMap(1280, 720)},split=4`))
  const upright = filterOf(hlsArgs('/in', '/out', probed({ hdr: true, width: 2160, height: 3840 }), 180))
  assert.ok(upright.startsWith(`[0:v:0]${toneMap(720, 1280)},`), 'a phone held upright stays upright')
})

test('HLS out: 4-second pieces, one playlist per quality, a master playlist, audio paired with each quality', () => {
  const args = hlsArgs('/in.mov', '/out', probed(), 180)
  const at = (flag: string) => args[args.indexOf(flag) + 1]
  assert.equal(at('-f'), 'hls')
  assert.equal(at('-hls_time'), '4')
  assert.equal(at('-hls_segment_type'), 'fmp4')
  assert.equal(at('-master_pl_name'), 'master.m3u8')
  assert.equal(at('-var_stream_map'), 'v:0,a:0,name:240 v:1,a:1,name:360 v:2,a:2,name:480 v:3,a:3,name:720')
  assert.equal(args.at(-1), '/out/%v/index.m3u8')
  assert.equal(at('-b:v:3'), '1800k')
  assert.equal(at('-g'), '60', 'a keyframe every 2 seconds at 30 fps, so every piece starts on one')
  assert.equal(at('-t'), '13.5', 'the probed length and a second, as the scan reads')
  assert.ok(args.indexOf('-threads') < args.indexOf('-i') && at('-threads') === '4', 'decoder threads capped, for memory')
  assert.ok(args.includes('-map_metadata'))
  const silent = hlsArgs('/in', '/out', probed({ hasAudio: false }), 180)
  assert.ok(silent.includes('-an') && !silent.includes('0:a:0'))
  assert.equal(silent[silent.indexOf('-var_stream_map') + 1], 'v:0,name:240 v:1,name:360 v:2,name:480 v:3,name:720')
})

test('untrusted input: no network protocols, no stdin, the first video stream only, no metadata, nothing past the scanned window', () => {
  const args = hlsArgs('/in/o.mp4', '/out', probed({ fps: 24 }), 180)
  assert.ok(args.join(' ').includes(`-protocol_whitelist ${FFMPEG_SAFETY.protocolWhitelist}`))
  assert.ok(args.indexOf('-protocol_whitelist') < args.indexOf('-i'), 'the whitelist applies to the input')
  assert.ok(args.includes('-nostdin'))
  assert.ok(filterOf(args).startsWith('[0:v:0]'), 'the stream the scan and the poster read')
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1')
  assert.ok(args.indexOf('-t') < args.indexOf('-i'), 'the window applies to the input')
  assert.equal(args[args.indexOf('-t') + 1], '13.5', 'the probed length and a second, never the file’s own say')
  assert.equal(hlsArgs('/in', '/out', probed({ durationMs: 400_000 }), 180)[args.indexOf('-t') + 1], '181', 'and never past the limit')
  assert.ok(!filterOf(args).includes('fps='), 'a 24 fps source is not resampled')
})

test('master-480 is the master playlist without its 720p quality', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-STREAM-INF:BANDWIDTH=382800,RESOLUTION=426x240,CODECS="avc1.4d4015,mp4a.40.2"',
    '240/index.m3u8',
    '',
    '#EXT-X-STREAM-INF:BANDWIDTH=1095600,RESOLUTION=854x480,CODECS="avc1.4d401e,mp4a.40.2"',
    '480/index.m3u8',
    '',
    '#EXT-X-STREAM-INF:BANDWIDTH=2085600,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"',
    '720/index.m3u8',
    '',
  ].join('\n')
  const capped = upTo480(master)
  assert.ok(!capped.includes('720/index.m3u8') && !capped.includes('1280x720'))
  assert.ok(capped.includes('240/index.m3u8') && capped.includes('480/index.m3u8') && capped.startsWith('#EXTM3U\n#EXT-X-VERSION:7'))
  const small = master.split('\n').slice(0, 8).join('\n')
  assert.equal(upTo480(small), small, 'nothing above 480: unchanged')
})

const hasFfmpeg = (() => {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('a real clip becomes a playable HLS set', { skip: !hasFfmpeg && 'ffmpeg is not installed here', timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hls-test-'))
  try {
    const clip = join(dir, 'clip.mp4')
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60:duration=9', '-f', 'lavfi', '-i', 'sine=duration=9', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip])
    const p = (await probe(clip))!
    const out = join(dir, 'out')
    for (const r of hlsLadder(p)) execFileSync('mkdir', ['-p', join(out, String(r.label))])
    execFileSync(FFMPEG, hlsArgs(clip, out, p, 180))
    const master = await readFile(join(out, 'master.m3u8'), 'utf8')
    assert.deepEqual([...master.matchAll(/^(\d+)\/index\.m3u8$/gm)].map((m) => m[1]), ['240', '360', '480', '720'])
    for (const label of ['240', '720']) {
      const files = await readdir(join(out, label))
      assert.ok(files.some((f) => /^init_\d+\.mp4$/.test(f)) && files.includes('index.m3u8'), files.join(' '))
      assert.equal(files.filter((f) => f.endsWith('.m4s')).length, 3, '9 seconds in 4-second pieces')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
