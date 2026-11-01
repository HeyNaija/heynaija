import { z } from 'zod'

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
  // Open question 2: 60 seconds, 100 MB, 1080p (longest edge), one video per post.
  // At most 78: the scan samples one frame a second plus the last in 80 frames, so a longer clip could not be covered.
  VIDEO_MAX_SECONDS: num(1, 78, 60),
  VIDEO_MIN_SECONDS: num(0, 60, 3),
  VIDEO_MAX_BYTES: num(1 * MIB, 2048 * MIB, 100 * MIB),
  VIDEO_MAX_EDGE: num(240, 7680, 1920),
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
  VIDEO_KEEP_ORIGINALS: z
    .enum(['false', 'true'])
    .default('false')
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
}

type VideoEnv = { [K in keyof typeof videoEnvShape]: z.output<(typeof videoEnvShape)[K]> }

export const videoConfig = (env: VideoEnv): VideoConfig => ({
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
})

/** The ADR's defaults, for tests and for code that has no environment. */
export const DEFAULT_VIDEO_CONFIG: VideoConfig = videoConfig(z.object(videoEnvShape).parse({}))

/** What the browser may say a video is; the server decides by probing (ADR section 1). */
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const
export type VideoType = (typeof VIDEO_TYPES)[number]

/** The rendition ladder: short edges in pixels, as in ADR 0019 section 3.1. */
export const RENDITION_LABELS = [240, 360, 480] as const
export const VIDEO_QUEUE = 'video'
