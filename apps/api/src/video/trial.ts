import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { ArachnidShieldScanner } from '../media/arachnid-shield.js'
import { FFMPEG, type Probe, probe } from './ffmpeg.js'
import { hlsArgs, hlsLadder } from './hls.js'

/**
 * The video trial's work (docs/video-trial.md; the command is `cli/video-trial.ts`):
 * one clip probed, checked by Arachnid Shield, encoded with the worker's HLS command
 * and measured; the results as a table; a phone test page; the upload and clean-up
 * of `trial/<run id>/` in the media bucket.
 */

export const CLIP_TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }
/** The agreed largest picture: 4K, 3840 pixels on the long side. */
export const MAX_EDGE = 3840
const FILE_TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4', '.html': 'text/html; charset=utf-8' }

export type ClipResult = {
  clip: string
  slug: string
  bytes: number
  probe: Probe | null
  shield: { verdict: string; ms: number; error?: string } | null
  encode: { wallS: number; cpuS: number; maxRssMb: number; outBytes: number; rungs: { label: number; bytes: number; pieces: number }[] } | null
  error?: string
}

/** A folder name for a clip: its file name in lower case, letters and digits only. */
export const slugOf = (file: string, taken: Set<string>): string => {
  const base = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clip'
  let slug = base
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`
  taken.add(slug)
  return slug
}

/**
 * The worker's command with ffmpeg's `-benchmark` on. Its lines are printed at the `info` level,
 * so the trial runs at that level where the worker runs at `error`; nothing else changes.
 */
export const benchmarked = (args: string[]): string[] => {
  const level = args.indexOf('-loglevel')
  return ['-benchmark', ...args.map((a, i) => (level >= 0 && i === level + 1 ? 'info' : a))]
}

/** ffmpeg's `-benchmark` lines: CPU seconds (user + system), wall seconds and peak memory. */
export const parseBenchmark = (stderr: string, platform: string = process.platform) => {
  const t = /bench: utime=([\d.]+)s stime=([\d.]+)s rtime=([\d.]+)s/.exec(stderr)
  const m = /bench: maxrss=(\d+)\s*(KiB|kB)/.exec(stderr)
  // ffmpeg prints Linux's unit (KiB) whatever the system; macOS's figure is really bytes.
  const perMb = platform === 'darwin' ? 1024 * 1024 : 1024
  return { cpuS: t ? Number(t[1]) + Number(t[2]) : NaN, wallS: t ? Number(t[3]) : NaN, maxRssMb: m ? Number(m[1]) / perMb : NaN }
}

const sh = (file: string, args: string[], timeoutMs: number) =>
  new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) =>
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, stderr: String(stderr) }),
    )
  })

async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await filesUnder(path)))
    else out.push(path)
  }
  return out
}

/** One clip: probe, Shield, encode. A clip Shield matches is stopped before it is encoded. */
export async function runClip(path: string, slug: string, outDir: string, shield: ArachnidShieldScanner | null, maxSeconds: number): Promise<ClipResult> {
  const result: ClipResult = { clip: basename(path), slug, bytes: (await stat(path)).size, probe: null, shield: null, encode: null }
  result.probe = await probe(path)
  if (!result.probe) return { ...result, error: 'not a video ffprobe can read (or more than one video stream)' }
  // What the worker would refuse, refused here too, so no time is spent on it.
  if (result.probe.durationMs > maxSeconds * 1000) return { ...result, error: `longer than ${maxSeconds} s: the worker would refuse it` }
  if (Math.max(result.probe.width, result.probe.height) > MAX_EDGE) return { ...result, error: 'bigger than 4K: the worker would refuse it' }

  // The check comes first, as in the worker.
  if (shield) {
    const started = Date.now()
    try {
      const scan = await shield.scanVideo({ path, contentType: CLIP_TYPES[extname(path).toLowerCase()] ?? 'video/mp4' })
      result.shield = { verdict: scan.verdict, ms: Date.now() - started }
    } catch (err) {
      result.shield = { verdict: 'no answer', ms: Date.now() - started, error: (err as Error).message }
    }
    if (result.shield.verdict === 'match') {
      return { ...result, error: 'MATCHED BY ARACHNID SHIELD. Stopped: not encoded, not uploaded. Do not open this file; tell whoever handles safety.' }
    }
  }

  const clipOut = join(outDir, slug)
  await rm(clipOut, { recursive: true, force: true })
  for (const r of hlsLadder(result.probe)) await mkdir(join(clipOut, String(r.label)), { recursive: true })
  const run = await sh(FFMPEG, benchmarked(hlsArgs(path, clipOut, result.probe, maxSeconds)), 60 * 60_000)
  if (run.code !== 0) return { ...result, error: `ffmpeg failed: ${lastError(run.stderr)}` }
  const bench = parseBenchmark(run.stderr)
  const rungs = []
  for (const r of hlsLadder(result.probe)) {
    const files = await readdir(join(clipOut, String(r.label)))
    let bytes = 0
    for (const f of files) bytes += (await stat(join(clipOut, String(r.label), f))).size
    rungs.push({ label: r.label, bytes, pieces: files.filter((f) => f.endsWith('.m4s')).length })
  }
  result.encode = { ...bench, outBytes: rungs.reduce((a, r) => a + r.bytes, 0), rungs }
  return result
}

/** The last lines ffmpeg wrote that look like errors, on one line. */
const lastError = (stderr: string) =>
  stderr
    .split('\n')
    .filter((l) => /error|no such|invalid|failed|not found/i.test(l))
    .slice(-3)
    .join(' / ')
    .slice(0, 300) || stderr.slice(-300)

/** A table cell: one line, no column breaks. */
const cell = (s: string) => s.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/')

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1)
const seconds = (ms: number) => (ms / 1000).toFixed(1)

/** The results as a Markdown table, the columns the plan's results table needs and the ones behind them. */
export function resultsTable(results: ClipResult[]): string {
  const rows = results.map((r) => {
    const p = r.probe
    const picture = p ? `${p.width}x${p.height}, ${Math.round(p.fps)} fps, ${p.videoCodec}${p.hdr ? ', HDR' : ''}` : '?'
    const length = p ? `${seconds(p.durationMs)} s` : '?'
    const e = r.encode
    const perSecond = e && p ? (e.cpuS / (p.durationMs / 1000)).toFixed(2) : ''
    const perMinute = e && p ? `${mb((e.outBytes / p.durationMs) * 60_000)} MB` : ''
    const shield = r.shield ? `${r.shield.verdict}, ${seconds(r.shield.ms)} s${r.shield.error ? ` (${r.shield.error})` : ''}` : 'not checked'
    const encode = e ? `${e.wallS.toFixed(1)} s` : r.error ?? ''
    return `| ${[r.clip, picture, length, `${mb(r.bytes)} MB`, encode, perSecond, e ? `${Math.round(e.maxRssMb)} MB` : '', perMinute, shield].map(cell).join(' | ')} |`
  })
  return [
    '| Clip | Picture and fps | Length | Size | Encode time | CPU-s per s of video | Peak memory | Stored per minute | Shield |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** A page that plays each clip as HLS (built in on iPhones, hls.js elsewhere) and shows start time, quality and stalls. */
export function testPage(runId: string, results: ClipResult[]): string {
  const clips = results.filter((r) => r.encode)
  const items = clips
    .map((r) => `<section><h2>${escapeHtml(r.clip)}</h2><video data-src="${escapeHtml(r.slug)}/master.m3u8" controls playsinline preload="none"></video><p class="stats">Not started</p></section>`)
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Video trial ${escapeHtml(runId)}</title>
<style>body{font:16px system-ui,sans-serif;margin:16px;max-width:720px}video{width:100%;background:#000}section{margin:0 0 32px}.stats{color:#555;font-size:14px}</style>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js"></script></head>
<body><h1>Video trial ${escapeHtml(runId)}</h1><p>Tap play on each video. Below it: how long it took to start, the quality playing, and how often it stalled.</p>
${items}
<script>
for (const section of document.querySelectorAll('section')) {
  const video = section.querySelector('video'), stats = section.querySelector('.stats'), src = video.dataset.src
  let asked = 0, started = 0, stalls = 0, height = '?'
  const show = () => { stats.textContent = (started ? 'Started in ' + ((started - asked) / 1000).toFixed(1) + ' s' : 'Starting\\u2026') + ' \\u00b7 playing ' + height + ' \\u00b7 ' + stalls + ' stall(s)' }
  video.addEventListener('play', () => { if (!asked) asked = performance.now(); show() })
  video.addEventListener('playing', () => { if (!started) started = performance.now(); height = (video.videoHeight ? Math.min(video.videoHeight, video.videoWidth) + 'p' : height); show() })
  video.addEventListener('waiting', () => { if (started) { stalls++; show() } })
  video.addEventListener('resize', () => { height = Math.min(video.videoHeight, video.videoWidth) + 'p'; show() })
  if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = src
  else if (window.Hls && Hls.isSupported()) { const hls = new Hls(); hls.loadSource(src); hls.attachMedia(video) }
  else stats.textContent = 'This browser cannot play HLS'
}
</script></body></html>
`
}

function s3(): { client: S3Client; bucket: string; publicUrl: string } {
  const e = process.env
  const missing = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_MEDIA_BUCKET', 'TRIAL_PUBLIC_URL'].filter((k) => !e[k])
  if (missing.length) throw new Error(`--upload and --clean need ${missing.join(', ')} (docs/video-trial.md)`)
  const client = new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION || 'auto',
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
    forcePathStyle: true,
  })
  return { client, bucket: e.S3_MEDIA_BUCKET!, publicUrl: e.TRIAL_PUBLIC_URL!.replace(/\/$/, '') }
}

export async function upload(runId: string, outDir: string, results: ClipResult[]): Promise<string> {
  const { client, bucket, publicUrl } = s3()
  const prefix = `trial/${runId}`
  for (const r of results.filter((x) => x.encode)) {
    for (const file of await filesUnder(join(outDir, r.slug))) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}/${relative(outDir, file)}`,
          Body: await readFile(file),
          ContentType: FILE_TYPES[extname(file)] ?? 'application/octet-stream',
          // Short, so a re-run of the same id is seen at once; the pieces never change otherwise.
          CacheControl: 'public, max-age=300',
        }),
      )
    }
  }
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}/index.html`, Body: testPage(runId, results), ContentType: FILE_TYPES['.html'], CacheControl: 'no-store' }))
  return `${publicUrl}/${prefix}/index.html`
}

export async function clean(runId: string): Promise<number> {
  if (!/^[a-z0-9-]+$/.test(runId)) throw new Error('a run id is letters, digits and dashes, as printed by the run')
  const { client, bucket } = s3()
  let removed = 0
  for (;;) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `trial/${runId}/` }))
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }))
    if (keys.length === 0) return removed
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }))
    removed += keys.length
  }
}

/** Whether this ffmpeg can tone-map HDR (its zscale filter, from libzimg). */
export const canToneMap = () =>
  new Promise<boolean>((done) => execFile(FFMPEG, ['-hide_banner', '-filters'], { maxBuffer: 4 * 1024 * 1024 }, (_err, out) => done(/ zscale /.test(String(out)))))
