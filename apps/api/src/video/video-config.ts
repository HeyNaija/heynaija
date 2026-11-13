import { z } from 'zod'
import type { ScannerEnv } from '../media/scanners.js'

const MIB = 1024 * 1024

/** An optional number that may also be given empty (compose passes `${NAME:-}`), which means "use the default". */
const num = (min: number, max: number, def: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(min).max(max).default(def))

/**
 * The video limits and their defaults. Each is a setting, not a constant, so a
 * decision ADR 0019 leaves open (its "Open questions") can change without a
 * release; the defaults are the ADR's recommendations.
 */
export const videoEnvShape = {
  // ADR 0021 section 2: 3 minutes, 1 GB, 4K (longest edge), one video per post. Arachnid Shield checks
  // the whole file, so the length may go to 180; without it the scan is PhotoDNA's 80 frames, and
  // `videoConfig` holds the limit to what they cover (`FRAME_SCAN_MAX_SECONDS`).
  VIDEO_MAX_SECONDS: num(1, 180, 180),
  VIDEO_MIN_SECONDS: num(0, 60, 3),
  VIDEO_MAX_BYTES: num(1 * MIB, 2048 * MIB, 1024 * MIB),
  VIDEO_MAX_EDGE: num(240, 7680, 3840),
  // Parts of a multipart upload; 5 MiB is R2's and S3's minimum for all but the last.
  VIDEO_PART_BYTES: num(5 * MIB, 64 * MIB, 5 * MIB),
  // How long an open upload may be resumed before the sweep aborts it (the ADR: 24 hours).
  VIDEO_UPLOAD_WINDOW_HOURS: num(1, 168, 24),
  // Open question 5: who may post video first. An allow-list comes from the feature flag;
  // beyond it, accounts at least this old with no upheld moderation action in the lookback.
  VIDEO_MIN_ACCOUNT_AGE_DAYS: num(0, 3650, 7),
  VIDEO_UPHELD_LOOKBACK_DAYS: num(0, 3650, 90),
  VIDEO_MAX_LIVE_PER_MEMBER: num(1, 10_000, 50),
  // Open question 1: delete the original once the renditions are ready (yes). Blocked ones are always kept.
  // Empty is unset: compose passes `${VIDEO_KEEP_ORIGINALS:-}` as "".
  VIDEO_KEEP_ORIGINALS: z
    .preprocess((v) => (v === '' ? undefined : v), z.enum(['false', 'true']).default('false'))
    .transform((v) => v === 'true'),
}

export type VideoConfig = {
  maxSeconds: number
  minSeconds: number
  maxBytes: number
  maxEdge: number
  partBytes: number
  uploadWindowMs: number
  minAccountAgeDays: number
  upheldLookbackDays: number
  maxLivePerMember: number
  keepOriginals: boolean
  /**
   * Where readers fetch a video's files, ending without a slash: the media bucket's own domain
   * (`MEDIA_ORIGIN`), never the site's `/media`, which goes through our nginx (ADR 0021
   * section 4). The site's path only where there is no such domain: development.
   */
  filesBase: string
}

type VideoEnv = { [K in keyof typeof videoEnvShape]: z.output<(typeof videoEnvShape)[K]> } & { MEDIA_ORIGIN?: string }

/**
 * The longest clip the sampled frames cover when they are the whole scan: one a second
 * and the last, in PhotoDNA's 80 (`MAX_SAMPLE_FRAMES` in ffmpeg.ts).
 */
export const FRAME_SCAN_MAX_SECONDS = 78

/**
 * The limits in effect. Without Arachnid Shield, which checks every frame of the whole file,
 * the length is held to what the sampled frames cover (ADR 0021 section 2), whatever
 * `VIDEO_MAX_SECONDS` says; the API and the worker read the same scanner settings, so both
 * hold the same limit, and `/v1/me` reports it.
 */
export const videoConfig = (env: VideoEnv & ScannerEnv): VideoConfig => {
  const settings = settingsOf(env)
  const shield = Boolean(env.ARACHNID_SHIELD_USERNAME && env.ARACHNID_SHIELD_PASSWORD)
  return shield ? settings : { ...settings, maxSeconds: Math.min(settings.maxSeconds, FRAME_SCAN_MAX_SECONDS) }
}

const settingsOf = (env: VideoEnv): VideoConfig => ({
  maxSeconds: env.VIDEO_MAX_SECONDS,
  minSeconds: env.VIDEO_MIN_SECONDS,
  maxBytes: env.VIDEO_MAX_BYTES,
  maxEdge: env.VIDEO_MAX_EDGE,
  partBytes: env.VIDEO_PART_BYTES,
  uploadWindowMs: env.VIDEO_UPLOAD_WINDOW_HOURS * 3_600_000,
  minAccountAgeDays: env.VIDEO_MIN_ACCOUNT_AGE_DAYS,
  upheldLookbackDays: env.VIDEO_UPHELD_LOOKBACK_DAYS,
  maxLivePerMember: env.VIDEO_MAX_LIVE_PER_MEMBER,
  keepOriginals: env.VIDEO_KEEP_ORIGINALS,
  filesBase: env.MEDIA_ORIGIN ?? '/media',
})

/** What the browser is told, so its checks before sending match the server's (apps/web/lib/video.ts). */
export const videoLimitsOf = (cfg: VideoConfig) => ({ maxBytes: cfg.maxBytes, maxSeconds: cfg.maxSeconds, minSeconds: cfg.minSeconds, maxEdge: cfg.maxEdge })

/** The ADR's defaults, with Arachnid Shield bound, for tests and for code that has no environment. */
export const DEFAULT_VIDEO_CONFIG: VideoConfig = settingsOf(z.object(videoEnvShape).parse({}))

/** What the browser may say a video is; the server decides by probing (ADR section 1). */
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

export const VIDEO_QUEUE = 'video'
