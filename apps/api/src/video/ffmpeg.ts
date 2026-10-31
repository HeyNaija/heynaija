import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { RENDITION_LABELS, type VideoConfig } from './video-config.js'

/**
 * ffmpeg parses files strangers send us, so every call carries these (ADR 0019
 * section 3.4): no network protocols, no stdin, a wall-clock limit. The
 * container adds the rest (non-root, read-only root, no network but Redis and storage).
 */
export const FFMPEG_SAFETY = { protocolWhitelist: 'file,pipe', timeoutMs: 5 * 60_000, probeTimeoutMs: 30_000 }

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

export type Probe = {
  formatName: string
  durationMs: number
  /** As shown: a clip stored sideways with a rotation flag is reported upright. */
  width: number
  height: number
  fps: number
  hasAudio: boolean
  videoCodec: string
}

export type Rejection = 'too_long' | 'too_short' | 'too_large' | 'too_big_picture' | 'not_a_video'

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** MP4, MOV (QuickTime) and WebM, decided by what ffprobe finds, never by the browser's type. */
const CONTAINERS = ['mov', 'mp4', 'matroska', 'webm']

const frameRate = (text: unknown): number => {
  const [n, d] = String(text ?? '0/1').split('/').map(Number)
  return d ? n! / d : (n ?? 0)
}

/** What ffprobe said, as a Probe; null when it is not a usable video. */
export function parseProbe(json: unknown): Probe | null {
  if (!isObject(json) || !isObject(json.format) || !Array.isArray(json.streams)) return null
  const formatName = typeof json.format.format_name === 'string' ? json.format.format_name : ''
  if (!formatName.split(',').some((f) => CONTAINERS.includes(f))) return null
  const seconds = Number(json.format.duration)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const streams = json.streams.filter(isObject)
  const video = streams.find((s) => s.codec_type === 'video')
  if (!video || !Number.isInteger(video.width) || !Number.isInteger(video.height)) return null
  const side = Array.isArray(video.side_data_list) ? video.side_data_list.filter(isObject) : []
  const rotation = Number(side.find((d) => d.rotation !== undefined)?.rotation ?? (isObject(video.tags) ? video.tags.rotate : 0) ?? 0)
  const sideways = Math.abs(Math.round(rotation / 90)) % 2 === 1
  const [width, height] = sideways ? [video.height as number, video.width as number] : [video.width as number, video.height as number]
  return {
    formatName,
    durationMs: Math.round(seconds * 1000),
    width,
    height,
    fps: frameRate(video.avg_frame_rate) || frameRate(video.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    videoCodec: typeof video.codec_name === 'string' ? video.codec_name : 'unknown',
  }
}

/** The server's own verdict on a probed file; null means within every limit (ADR section 1). */
export function checkLimits(p: Probe | null, bytes: number, cfg: VideoConfig): Rejection | null {
  if (!p) return 'not_a_video'
  if (bytes > cfg.maxBytes) return 'too_large'
  if (p.durationMs > cfg.maxSeconds * 1000) return 'too_long'
  if (p.durationMs < cfg.minSeconds * 1000) return 'too_short'
  if (Math.max(p.width, p.height) > cfg.maxEdge) return 'too_big_picture'
  return null
}

export type Rendition = { label: number; width: number; height: number; videoKbps: number; audioKbps: number }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

const bitrates = (label: number) => (label <= 240 ? [300, 48] : label <= 360 ? [550, 64] : [900, 64]) as [number, number]

/**
 * Short edge 240, 360 and 480 (so a 1080x1920 phone clip does not become a
 * 1920 pixel wide file), never enlarged. A clip smaller than the whole ladder
 * gets one rendition at its own size.
 */
export function renditionPlan(p: Pick<Probe, 'width' | 'height'>): Rendition[] {
  const short = Math.min(p.width, p.height)
  const labels: number[] = RENDITION_LABELS.filter((l) => l <= short)
  if (labels.length === 0) labels.push(short)
  return labels.map((label) => {
    const scale = label / short
    const [width, height] = p.width <= p.height ? [label, even(p.height * scale)] : [even(p.width * scale), label]
    const [videoKbps, audioKbps] = bitrates(label)
    return { label, width: even(width), height: even(height), videoKbps, audioKbps }
  })
}

/** One ffmpeg run: decode once, one encode per rendition (ADR sections 3.1 and 3.4). */
export function transcodeArgs(input: string, outputs: string[], p: Probe, cfg: VideoConfig): string[] {
  const plan = renditionPlan(p)
  if (outputs.length !== plan.length) throw new Error(`one output per rendition: ${plan.length} needed, ${outputs.length} given`)
  const cap = p.fps > 30.5 ? 'fps=30,' : ''
  const gop = String(Math.round(Math.min(30, p.fps || 30) * 2))
  const split = plan.length > 1 ? `[0:v:0]split=${plan.length}${plan.map((_, i) => `[s${i}]`).join('')};` : ''
  const graph =
    split +
    plan.map((r, i) => `${plan.length > 1 ? `[s${i}]` : '[0:v:0]'}${cap}scale=${r.width}:${r.height}:flags=bicubic,setsar=1[o${i}]`).join(';')
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist,
    // The probe's duration is only a claim: stop reading past the limit (plus a second of slack).
    '-t', String(cfg.maxSeconds + 1),
    '-i', input,
    '-filter_complex', graph,
    ...plan.flatMap((r, i) => [
      '-map', `[o${i}]`,
      ...(p.hasAudio ? ['-map', '0:a:0'] : ['-an']),
      '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-b:v', `${r.videoKbps}k`, '-maxrate', `${r.videoKbps}k`, '-bufsize', `${r.videoKbps * 2}k`,
      '-g', gop, '-keyint_min', gop, '-sc_threshold', '0',
      ...(p.hasAudio ? ['-c:a', 'aac', '-b:a', `${r.audioKbps}k`, '-ac', '2'] : []),
      // Location and device metadata are dropped, as sharp drops EXIF for images.
      '-map_metadata', '-1',
      '-movflags', '+faststart',
      '-threads', '2',
      outputs[i]!,
    ]),
  ]
}

/** How many scene-change frames fit beside `secondFrames` one-a-second frames and the last, within 80 and 20. */
export const MAX_SAMPLE_FRAMES = 80
export const MAX_SCENE_FRAMES = 20
export const sceneBudget = (secondFrames: number): number => Math.max(0, Math.min(MAX_SCENE_FRAMES, MAX_SAMPLE_FRAMES - (secondFrames + 1)))

/** Frame times in ms from the `pts_time:` fields of ffmpeg's showinfo log. */
export const parseShowinfo = (log: string): number[] =>
  [...log.matchAll(/pts_time:\s*([0-9.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000))

type Run = { stdout: Buffer; stderr: string; code: number }

function run(file: string, args: string[], timeoutMs: number): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number | string; killed?: boolean }) | null
      // A missing binary or a killed process is the job's problem (retry), not the file's.
      if (e && (e.code === 'ENOENT' || e.killed)) return reject(new Error(`${file} ${e.killed ? 'timed out' : 'is not installed'}`))
      resolve({ stdout, stderr: stderr.toString(), code: e ? (typeof e.code === 'number' ? e.code : 1) : 0 })
    })
  })
}

/** Probes a file. Null when it is not a video ffprobe can read (permanent); throws when ffprobe itself cannot run (retry). */
export async function probe(path: string): Promise<Probe | null> {
  const res = await run(
    FFPROBE,
    ['-v', 'error', '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist, '-print_format', 'json', '-show_format', '-show_streams', path],
    FFMPEG_SAFETY.probeTimeoutMs,
  )
  if (res.code !== 0) return null
  try {
    return parseProbe(JSON.parse(res.stdout.toString()))
  } catch {
    return null
  }
}

/** Writes one MP4 per rendition to `outputs`. Throws on any ffmpeg failure; the caller decides if that is retryable. */
export async function transcode(input: string, outputs: string[], p: Probe, cfg: VideoConfig): Promise<void> {
  const res = await run(FFMPEG, transcodeArgs(input, outputs, p, cfg), FFMPEG_SAFETY.timeoutMs)
  if (res.code !== 0) throw new Error(`ffmpeg could not encode the video: ${res.stderr.slice(-500)}`)
}

const still = (input: string, atMs: number, out: string, filter: string) => [
  '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
  '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist,
  '-ss', (atMs / 1000).toFixed(3), '-i', input, '-frames:v', '1', '-vf', filter, '-q:v', '2', out,
]

/** The poster frame as a WebP no larger than 640 px: a frame 1 s in, or the middle of a clip under 2 s. */
export async function extractPoster(input: string, workPath: string, durationMs: number): Promise<Buffer> {
  const at = durationMs < 2000 ? Math.floor(durationMs / 2) : 1000
  const res = await run(FFMPEG, still(input, at, workPath, 'scale=640:640:force_original_aspect_ratio=decrease'), FFMPEG_SAFETY.timeoutMs)
  if (res.code !== 0) throw new Error(`ffmpeg could not take a poster frame: ${res.stderr.slice(-300)}`)
  // sharp, not ffmpeg's WebP encoder, which not every ffmpeg build has; it also drops metadata.
  return sharp(await readFile(workPath)).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
}

export type SampledFrame = { ms: number; jpeg: Buffer }

/**
 * The frames that are scanned (ADR 0019 section 4.1), taken from the ORIGINAL, not
 * from our re-encode, which could blur a match away: one a second, the last, and
 * up to 20 where the scene changes, at most 80 in all, in time order.
 */
export async function extractFrames(input: string, dir: string, durationMs: number): Promise<SampledFrame[]> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const common = ['-nostdin', '-hide_banner', '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist, '-t', String(durationMs / 1000 + 1), '-i', input]
  const scale = 'scale=1280:1280:force_original_aspect_ratio=decrease'
  const frames: SampledFrame[] = []

  const seconds = await run(FFMPEG, [...common, '-loglevel', 'error', '-vf', `fps=1,${scale}`, '-q:v', '3', join(dir, 's-%04d.jpg')], FFMPEG_SAFETY.timeoutMs)
  if (seconds.code !== 0) throw new Error(`ffmpeg could not sample frames: ${seconds.stderr.slice(-300)}`)
  const secondFiles = (await readdir(dir)).filter((f) => f.startsWith('s-')).sort()
  for (const [i, f] of secondFiles.entries()) frames.push({ ms: i * 1000, jpeg: await readFile(join(dir, f)) })

  const last = await run(FFMPEG, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist, '-sseof', '-0.2', '-i', input, '-update', '1', '-frames:v', '1', '-vf', scale, '-q:v', '3', '-y', join(dir, 'last.jpg')], FFMPEG_SAFETY.timeoutMs)
  if (last.code === 0) frames.push({ ms: Math.max(0, durationMs - 200), jpeg: await readFile(join(dir, 'last.jpg')) })

  const budget = sceneBudget(secondFiles.length)
  if (budget > 0) {
    const scenes = await run(
      FFMPEG,
      [...common, '-loglevel', 'info', '-vf', `select='gt(scene,0.4)',showinfo,${scale}`, '-vsync', 'vfr', '-frames:v', String(budget), '-q:v', '3', join(dir, 'c-%04d.jpg')],
      FFMPEG_SAFETY.timeoutMs,
    )
    if (scenes.code === 0) {
      const times = parseShowinfo(scenes.stderr)
      const files = (await readdir(dir)).filter((f) => f.startsWith('c-')).sort()
      for (const [i, f] of files.entries()) frames.push({ ms: times[i] ?? 0, jpeg: await readFile(join(dir, f)) })
    }
  }
  return frames.sort((a, b) => a.ms - b.ms).slice(0, MAX_SAMPLE_FRAMES)
}
