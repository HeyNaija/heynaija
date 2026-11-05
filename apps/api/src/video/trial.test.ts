import assert from 'node:assert/strict'
import { test } from 'node:test'
import { benchmarked, type ClipResult, parseBenchmark, resultsTable, slugOf, testPage } from './trial.js'

test('a clip gets a safe folder name, and two alike get different ones', () => {
  const taken = new Set<string>()
  assert.equal(slugOf('IMG_0042.MOV', taken), 'img-0042')
  assert.equal(slugOf('img 0042.mov', taken), 'img-0042-2')
  assert.equal(slugOf('../../etc/passwd.mp4', taken), 'passwd')
  assert.equal(slugOf('☃.mp4', taken), 'clip')
})

test("ffmpeg's -benchmark lines give CPU time, wall time and peak memory", () => {
  const stderr = 'bench: utime=54.890s stime=1.250s rtime=7.180s\nbench: maxrss=412000KiB\n'
  const b = parseBenchmark(stderr, 'linux')
  assert.ok(Math.abs(parseBenchmark('bench: maxrss=421888000KiB', 'darwin').maxRssMb - 402.3) < 0.1, 'macOS reports bytes')
  assert.ok(Math.abs(b.cpuS - 56.14) < 0.001)
  assert.equal(b.wallS, 7.18)
  assert.ok(Math.abs(b.maxRssMb - 402.3) < 0.1)
})

const result = (over: Partial<ClipResult> = {}): ClipResult => ({
  clip: 'IMG_0042.MOV',
  slug: 'img-0042',
  bytes: 510_000_000,
  probe: { formatName: 'mov', durationMs: 180_000, width: 3840, height: 2160, fps: 30, hasAudio: true, videoCodec: 'hevc', hdr: true },
  shield: { verdict: 'clear', ms: 9_400 },
  encode: { wallS: 126, cpuS: 1008, maxRssMb: 812, outBytes: 83_100_000, rungs: [] },
  ...over,
})

test('the trial runs the worker’s exact command, with ffmpeg’s timings switched on', () => {
  assert.deepEqual(benchmarked(['-nostdin', '-loglevel', 'error', '-i', 'in']), ['-benchmark', '-nostdin', '-loglevel', 'info', '-i', 'in'])
})

test('the results table: the plan’s columns and the numbers behind them', () => {
  const table = resultsTable([result(), result({ clip: 'bad.mov', encode: null, error: 'ffmpeg failed: x\nError | y' })])
  const [, , first, second] = table.split('\n')
  assert.equal(first, '| IMG_0042.MOV | 3840x2160, 30 fps, hevc, HDR | 180.0 s | 510.0 MB | 126.0 s | 5.60 | 812 MB | 27.7 MB | clear, 9.4 s |')
  assert.match(second!, /\| bad\.mov \|.*\| ffmpeg failed: x Error \/ y \|/, 'one line, no stray column')
})

test('the test page escapes clip names and lists only encoded clips', () => {
  const page = testPage('202611041430', [result({ clip: '<b>x</b>.mov' }), result({ clip: 'skipped.mov', slug: 'skipped', encode: null })])
  assert.ok(page.includes('&#60;b&#62;x&#60;/b&#62;.mov') && !page.includes('<b>x</b>'))
  assert.ok(page.includes('data-src="img-0042/master.m3u8"'))
  assert.ok(!page.includes('skipped/master.m3u8'))
  assert.ok(page.includes('hls.js@1.5.17'), 'a pinned hls.js')
})
