import { type Deadline, FFMPEG, FFMPEG_SAFETY, type Probe, run, runTimeoutMs } from './ffmpeg.js'

/**
 * Video as HLS (ADR 0021 section 3, docs/video-trial.md):
 * one ffmpeg pass turns the original into 4-second pieces at up to four qualities,
 * with a playlist per quality and a master playlist the player chooses from. Up to
 * 4K and 60 fps goes in; at most 720p and 30 fps comes out; HDR is tone-mapped to
 * ordinary colour, since an 8-bit encode of it looks grey and washed out.
 *
 * The trial (`cli/video-trial.ts`) runs exactly this, so what it measures is what
 * the worker will do.
 */

/** Short edge in pixels and the bitrates for it; a quality above the original's short edge is skipped. */
export const HLS_LADDER = [
  { label: 240, videoKbps: 300, audioKbps: 48 },
  { label: 360, videoKbps: 550, audioKbps: 64 },
  { label: 480, videoKbps: 900, audioKbps: 64 },
  { label: 720, videoKbps: 1800, audioKbps: 96 },
] as const

/** Threads ffmpeg decodes the original with. */
export const DECODER_THREADS = 4

/** Seconds of video in each piece. */
export const HLS_PIECE_SECONDS = 4

/** What a reader's browser is told each file is, by its extension. */
export const HLS_CONTENT_TYPES: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4' }

export type HlsRung = { label: number; width: number; height: number; videoKbps: number; audioKbps: number }

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** The qualities made from a clip of this (upright) size; one at its own size when it is smaller than them all. */
export function hlsLadder(p: Pick<Probe, 'width' | 'height'>): HlsRung[] {
  const short = Math.min(p.width, p.height)
  const rungs: { label: number; videoKbps: number; audioKbps: number }[] = HLS_LADDER.filter((r) => r.label <= short)
  if (rungs.length === 0) rungs.push({ ...HLS_LADDER[0], label: short })
  return rungs.map((r) => {
    const scale = r.label / short
    const [width, height] = p.width <= p.height ? [r.label, p.height * scale] : [p.width * scale, r.label]
    return { ...r, width: even(width), height: even(height) }
  })
}

/**
 * PQ or HLG in, BT.709 out, at the given size: scaled and taken to linear light in one step,
 * then BT.709 primaries, Hable's curve and 8-bit 4:2:0. Done at the largest size we serve, not
 * the original's: at 4K the float frames cost about nine times the work and more memory than
 * the worker has (the trial measured 1.5 GB). Needs ffmpeg's zscale (libzimg), which Debian's
 * ffmpeg has.
 */
export const toneMap = (width: number, height: number) =>
  `zscale=w=${width}:h=${height}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`

/**
 * One ffmpeg run: decode once, tone-map if HDR, cap at 30 fps, one encode per quality,
 * written into `outDir` as `<label>/index.m3u8`, `<label>/init_<n>.mp4`, `<label>/piece-NNN.m4s`
 * and `master.m3u8`. Reads at most the probed length and a second, as the scan window does.
 */
export function hlsArgs(input: string, outDir: string, p: Probe, maxSeconds: number): string[] {
  const rungs = hlsLadder(p)
  const fps = p.fps > 30.5 ? 30 : p.fps || 30
  // A keyframe every 2 seconds, so every 4-second piece starts on one.
  const gop = String(Math.round(fps * 2))
  // Down to the largest quality first, once (tone-mapping on the way for HDR), so the split and
  // the smaller qualities never handle the original's full size.
  const top = rungs.at(-1)!
  const larger = top.width < p.width || top.height < p.height
  const first = p.hdr ? `${toneMap(top.width, top.height)},` : larger ? `scale=${top.width}:${top.height}:flags=bicubic,` : ''
  const head = `[0:v:0]${p.fps > 30.5 ? 'fps=30,' : ''}${first}`
  const graph =
    rungs.length > 1
      ? `${head}split=${rungs.length}${rungs.map((_, i) => `[s${i}]`).join('')};` +
        rungs.map((r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=bicubic,setsar=1,format=yuv420p[o${i}]`).join(';')
      : `${head}scale=${rungs[0]!.width}:${rungs[0]!.height}:flags=bicubic,setsar=1,format=yuv420p[o0]`
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-protocol_whitelist', FFMPEG_SAFETY.protocolWhitelist,
    '-t', String(Math.min(p.durationMs, maxSeconds * 1000) / 1000 + 1),
    // Four decoder threads: as fast as letting ffmpeg choose, and a 4K HDR original peaked at
    // 840 MB instead of 1.1 GB in the trial, inside the worker's memory limit.
    '-threads', String(DECODER_THREADS),
    '-i', input,
    '-filter_complex', graph,
    ...rungs.flatMap((_, i) => ['-map', `[o${i}]`, ...(p.hasAudio ? ['-map', '0:a:0'] : [])]),
    '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'veryfast',
    '-g', gop, '-keyint_min', gop, '-sc_threshold', '0',
    ...rungs.flatMap((r, i) => [`-b:v:${i}`, `${r.videoKbps}k`, `-maxrate:v:${i}`, `${r.videoKbps}k`, `-bufsize:v:${i}`, `${r.videoKbps * 2}k`]),
    ...(p.hasAudio ? ['-c:a', 'aac', '-ac', '2', ...rungs.flatMap((r, i) => [`-b:a:${i}`, `${r.audioKbps}k`])] : ['-an']),
    // Location and device metadata are dropped, as for images.
    '-map_metadata', '-1',
    '-f', 'hls',
    '-hls_time', String(HLS_PIECE_SECONDS),
    '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4',
    '-hls_flags', 'independent_segments',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_segment_filename', `${outDir}/%v/piece-%03d.m4s`,
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', rungs.map((r, i) => (p.hasAudio ? `v:${i},a:${i},name:${r.label}` : `v:${i},name:${r.label}`)).join(' '),
    `${outDir}/%v/index.m3u8`,
  ]
}

/** Encodes the original into `outDir` (see `hlsArgs`). Throws on any ffmpeg failure; the caller decides if that is retryable. */
export async function encodeHls(input: string, outDir: string, p: Probe, maxSeconds: number, deadline: Deadline): Promise<void> {
  const res = await run(FFMPEG, hlsArgs(input, outDir, p, maxSeconds), runTimeoutMs(Math.min(p.durationMs, maxSeconds * 1000)), deadline)
  if (res.code !== 0) throw new Error(`ffmpeg could not encode the video: ${res.stderr.slice(-500)}`)
}

/**
 * `master-480.m3u8`: the master playlist without the qualities above 480, for the `auto` data
 * setting (ADR 0021 section 7). Each quality is a `#EXT-X-STREAM-INF` line and the playlist
 * path after it; a clip with nothing above 480 gets the master as it is.
 */
export function upTo480(master: string): string {
  const lines = master.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i]!.startsWith('#EXT-X-STREAM-INF') ? Number(/^(\d+)\//.exec(lines[i + 1] ?? '')?.[1]) : NaN
    if (label > 480) {
      i++
      continue
    }
    out.push(lines[i]!)
  }
  return out.join('\n')
}
