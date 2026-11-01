import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { DEFAULT_VIDEO_CONFIG, RENDITION_LABELS, type VideoConfig } from './video-config.js'

/**
 * ffmpeg parses files strangers send us, so every call carries these (ADR 0019
 * section 3.4): no network protocols, no stdin, a wall-clock limit per run and one
 * for the whole job (`jobTimeoutMs`, shared by every run of a job). This file does
 * only that. Confining the process (non-root, read-only root, dropped capabilities,
 * a network that cannot reach Kratos) is the deployment's job: see the
 * `video-worker` service in `infra/deploy/compose.yml` and docs/video-spike.md for
 * what it does and does not do.
 */
export const FFMPEG_SAFETY = { protocolWhitelist: 'file,pipe', timeoutMs: 5 * 60_000, probeTimeoutMs: 30_000, jobTimeoutMs: 8 * 60_000 }

/** Running out of time is a property of the file, not a glitch: it will run out again, so it is never retried. */
export class FfmpegTimeout extends Error {
  constructor(what: string) {
    super(`${what} timed out`)
    this.name = 'FfmpegTimeout'
  }
}

/** The container's duration is a claim; the frames found disagree with it by more than the slack. */
export class DurationMismatch extends Error {
  constructor(claimedMs: number, frames: number) {
    super(`the file claims ${Math.round(claimedMs / 1000)} s but holds at least ${frames} seconds of video`)
    this.name = 'DurationMismatch'
  }
}

/** One wall-clock limit shared by all the runs of a job. */
export type Deadline = { at: number }
export const newDeadline = (ms: number = FFMPEG_SAFETY.jobTimeoutMs): Deadline => ({ at: Date.now() + ms })
export const expiredDeadline = (): Deadline => ({ at: Date.now() - 1 })

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
  /** The container's frame count when it states one (it is a claim too); omitted when it does not. */
  frameCount?: number
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
  // Exactly one video stream: the one scanned, posted-from and encoded is then the only one there is,
  // whatever `default` says. (Every read also maps `0:v:0`.)
  const videos = streams.filter((s) => s.codec_type === 'video')
  const video = videos[0]
  if (videos.length !== 1 || !video || !Number.isInteger(video.width) || !Number.isInteger(video.height)) return null
  const side = Array.isArray(video.side_data_list) ? video.side_data_list.filter(isObject) : []
  const rotation = Number(side.find((d) => d.rotation !== undefined)?.rotation ?? (isObject(video.tags) ? video.tags.rotate : 0) ?? 0)
  const sideways = Math.abs(Math.round(rotation / 90)) % 2 === 1
  const [width, height] = sideways ? [video.height as number, video.width as number] : [video.width as number, video.height as number]
  const nbFrames = Number(video.nb_frames)
  return {
    formatName,
    durationMs: Math.round(seconds * 1000),
    width,
    height,
    fps: frameRate(video.avg_frame_rate) || frameRate(video.r_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    videoCodec: typeof video.codec_name === 'string' ? video.codec_name : 'unknown',
    ...(Number.isFinite(nbFrames) && nbFrames > 0 ? { frameCount: nbFrames } : {}),
  }
}

/** No clip the limits allow has more frames a second than this. */
export const MAX_FPS = 60

/** The server's own verdict on a probed file; null means within every limit (ADR section 1). */
export function checkLimits(p: Probe | null, bytes: number, cfg: VideoConfig): Rejection | null {
  if (!p) return 'not_a_video'
  if (bytes > cfg.maxBytes) return 'too_large'
  if (p.durationMs > cfg.maxSeconds * 1000) return 'too_long'
  if (p.durationMs < cfg.minSeconds * 1000) return 'too_short'
  if (Math.max(p.width, p.height) > cfg.maxEdge) return 'too_big_picture'
  // A frame rate or frame count the limit cannot explain is a long encode in disguise.
  if (p.fps > MAX_FPS || (p.frameCount ?? 0) > cfg.maxSeconds * MAX_FPS) return 'too_long'
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
    // The same window the scan looked at: the probed length (already within the limit) plus a second.
    // The container's duration is only a claim, so nothing past that is ever encoded or published.
    '-t', String(Math.min(p.durationMs, cfg.maxSeconds * 1000) / 1000 + 1),
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

function run(file: string, args: string[], timeoutMs: number, deadline: Deadline): Promise<Run> {
  return new Promise((resolve, reject) => {
    const left = deadline.at - Date.now()
    if (left <= 0) return reject(new FfmpegTimeout(file))
    execFile(file, args, { timeout: Math.min(timeoutMs, left), maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number | string; killed?: boolean }) | null
      // A killed process ran out of time: permanent (FfmpegTimeout). A missing binary is the job's problem (retry).
      if (e?.killed) return reject(new FfmpegTimeout(file))
      if (e && e.code === 'ENOENT') return reject(new Error(`${file} is not installed`))
      resolve({ stdout, stderr: stderr.toString(), code: e ? (typeof e.code === 'number' ? e.code : 1) : 0 })
    })
  })
}

/** Probes a file. Null when it is not a video ffprobe can read (permanent); throws when ffprobe itself cannot run (retry). */
export async function probe(path: string, deadline: Deadline = newDeadline()): Promise<Probe | null> {
  const res = await run(
    FFPROBE,
    ['-v', 'error', '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist, '-print_format', 'json', '-show_format', '-show_streams', path],
    FFMPEG_SAFETY.probeTimeoutMs,
    deadline,
  )
  if (res.code !== 0) return null
  try {
    return parseProbe(JSON.parse(res.stdout.toString()))
  } catch {
    return null
  }
}

/** Writes one MP4 per rendition to `outputs`. Throws on any ffmpeg failure; the caller decides if that is retryable. */
export async function transcode(input: string, outputs: string[], p: Probe, cfg: VideoConfig, deadline: Deadline = newDeadline()): Promise<void> {
  const res = await run(FFMPEG, transcodeArgs(input, outputs, p, cfg), FFMPEG_SAFETY.timeoutMs, deadline)
  if (res.code !== 0) throw new Error(`ffmpeg could not encode the video: ${res.stderr.slice(-500)}`)
}

export const stillArgs = (input: string, atMs: number, out: string, filter: string) => [
  '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
  '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist,
  '-ss', (atMs / 1000).toFixed(3), '-i', input, '-map', '0:v:0', '-frames:v', '1', '-vf', filter, '-q:v', '2', out,
]

/** The poster frame as a WebP no larger than 640 px: a frame 1 s in, or the middle of a clip under 2 s. */
export async function extractPoster(input: string, workPath: string, durationMs: number, deadline: Deadline = newDeadline()): Promise<Buffer> {
  const at = durationMs < 2000 ? Math.floor(durationMs / 2) : 1000
  const res = await run(FFMPEG, stillArgs(input, at, workPath, 'scale=640:640:force_original_aspect_ratio=decrease'), FFMPEG_SAFETY.timeoutMs, deadline)
  if (res.code !== 0) throw new Error(`ffmpeg could not take a poster frame: ${res.stderr.slice(-300)}`)
  // sharp, not ffmpeg's WebP encoder, which not every ffmpeg build has; it also drops metadata.
  return sharp(await readFile(workPath)).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
}

export type SampledFrame = { ms: number; jpeg: Buffer }

const SCALE = 'scale=1280:1280:force_original_aspect_ratio=decrease'

/**
 * The three sampling runs' arguments. Each reads at most `maxSeconds + 1` of the
 * input whatever its container claims, and maps the first video stream, the one
 * the encode and the poster use.
 */
export function frameArgs(input: string, dir: string, durationMs: number, maxSeconds: number, budget = MAX_SCENE_FRAMES) {
  const safe = ['-nostdin', '-hide_banner', '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist]
  const common = [...safe, '-t', String(maxSeconds + 1), '-i', input, '-map', '0:v:0']
  return {
    seconds: [...common, '-loglevel', 'error', '-vf', `fps=1,${SCALE}`, '-q:v', '3', join(dir, 's-%04d.jpg')],
    last: [...safe, '-loglevel', 'error', '-sseof', '-0.2', '-i', input, '-map', '0:v:0', '-update', '1', '-frames:v', '1', '-vf', SCALE, '-q:v', '3', '-y', join(dir, 'last.jpg')],
    scenes: [...common, '-loglevel', 'info', '-vf', `select='gt(scene,0.4)',showinfo,${SCALE}`, '-vsync', 'vfr', '-frames:v', String(budget), '-q:v', '3', join(dir, 'c-%04d.jpg')],
  }
}

/**
 * The frames that are scanned (ADR 0019 section 4.1), taken from the ORIGINAL, not
 * from our re-encode, which could blur a match away: one a second, the last, and
 * up to 20 where the scene changes, at most 80 in all, in time order.
 *
 * The container's length is a claim, so the sampler reads up to the limit and a
 * second, and a file holding more seconds of video than it claims throws
 * `DurationMismatch` instead of being scanned in part.
 */
export async function extractFrames(
  input: string,
  dir: string,
  durationMs: number,
  maxSeconds: number = DEFAULT_VIDEO_CONFIG.maxSeconds,
  deadline: Deadline = newDeadline(),
): Promise<SampledFrame[]> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const args = frameArgs(input, dir, durationMs, maxSeconds)
  const frames: SampledFrame[] = []

  const seconds = await run(FFMPEG, args.seconds, FFMPEG_SAFETY.timeoutMs, deadline)
  if (seconds.code !== 0) throw new Error(`ffmpeg could not sample frames: ${seconds.stderr.slice(-300)}`)
  const secondFiles = (await readdir(dir)).filter((f) => f.startsWith('s-')).sort()
  // One frame a second of a clip of the length it claims is ceil(length) frames at most, plus one for rounding.
  if (secondFiles.length > Math.ceil(durationMs / 1000) + 1) throw new DurationMismatch(durationMs, secondFiles.length)
  for (const [i, f] of secondFiles.entries()) frames.push({ ms: i * 1000, jpeg: await readFile(join(dir, f)) })

  const last = await run(FFMPEG, args.last, FFMPEG_SAFETY.timeoutMs, deadline)
  if (last.code === 0) frames.push({ ms: Math.max(0, durationMs - 200), jpeg: await readFile(join(dir, 'last.jpg')) })

  const budget = sceneBudget(secondFiles.length)
  if (budget > 0) {
    const scenes = await run(FFMPEG, frameArgs(input, dir, durationMs, maxSeconds, budget).scenes, FFMPEG_SAFETY.timeoutMs, deadline)
    if (scenes.code === 0) {
      const times = parseShowinfo(scenes.stderr)
      const files = (await readdir(dir)).filter((f) => f.startsWith('c-')).sort()
      for (const [i, f] of files.entries()) frames.push({ ms: times[i] ?? 0, jpeg: await readFile(join(dir, f)) })
    }
  }
  return frames.sort((a, b) => a.ms - b.ms).slice(0, MAX_SAMPLE_FRAMES)
}
