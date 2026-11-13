import { openAsBlob } from 'node:fs'
import sharp from 'sharp'
import type { ContentScanner, VideoScan } from './media.service.js'

/**
 * Arachnid Shield, the Canadian Centre for Child Protection's free API
 * (https://shield.projectarachnid.com/docs/): an image or a whole video is posted as
 * the request body and compared with Project Arachnid's list of known child sexual
 * abuse material, exactly and by PhotoDNA near-match. A video is matched frame by
 * frame on their side, so it gets more than the frames we sample for PhotoDNA.
 */
export const ARACHNID_SHIELD_URL = 'https://shield.projectarachnid.com'

/**
 * The one answer that is not a match. `csam` and `harmful-abusive-material` are, and so is
 * `test` (their drill media, so the blocking path can be tried without real material);
 * the docs say more classes may come, and an unknown one counts as a match too.
 */
const NO_MATCH = 'no-known-match'

const IMAGE_TIMEOUT_MS = 30_000
// A whole video goes up and is matched frame by frame: minutes, not seconds. The video
// worker's job limit includes it (`jobTimeoutMs` in video/ffmpeg.ts).
export const SHIELD_VIDEO_TIMEOUT_MS = 5 * 60_000

type ScannedMedia = {
  classification?: unknown
  match_type?: 'exact' | 'near' | null
  near_match_details?: { timestamp?: number; classification?: string }[]
}

/**
 * Matches uploads against Arachnid Shield. Throws whenever it does not get a clear
 * answer, so the upload waits rather than being published unchecked.
 */
export class ArachnidShieldScanner implements ContentScanner {
  private readonly authorization: string

  constructor(
    username: string,
    password: string,
    private readonly url: string = ARACHNID_SHIELD_URL,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  /** The image as uploaded: Shield takes most formats, GIFs included, so it is not re-encoded first. */
  async scan(image: Buffer): Promise<'clear' | 'match'> {
    const found = await this.post(new Blob([new Uint8Array(image)]), await imageType(image), IMAGE_TIMEOUT_MS)
    return found.classification === NO_MATCH ? 'clear' : 'match'
  }

  /** The original file, streamed from disk. On a near match, the time Shield gives for the first matching frame. */
  async scanVideo(video: { path: string; contentType: string }): Promise<VideoScan> {
    const found = await this.post(await openAsBlob(video.path), video.contentType, SHIELD_VIDEO_TIMEOUT_MS)
    if (found.classification === NO_MATCH) return { verdict: 'clear', matchMs: null }
    const near = found.near_match_details?.find((d) => typeof d.timestamp === 'number')
    return { verdict: 'match', matchMs: near ? Math.round(near.timestamp! * 1000) : null }
  }

  private async post(body: Blob, contentType: string, timeoutMs: number): Promise<ScannedMedia> {
    const res = await this.fetchFn(`${this.url}/v1/media`, {
      method: 'POST',
      headers: { authorization: this.authorization, 'content-type': contentType },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const found = (await res.json().catch(() => null)) as (ScannedMedia & { detail?: unknown }) | null
    if (!res.ok || typeof found?.classification !== 'string') {
      const detail = typeof found?.detail === 'string' ? found.detail : found?.detail ? JSON.stringify(found.detail).slice(0, 200) : 'no detail'
      throw new Error(`Arachnid Shield gave no answer (HTTP ${res.status}: ${detail})`)
    }
    return found
  }
}

/** What to call an image in the request: its real format, not what the browser said. */
async function imageType(image: Buffer): Promise<string> {
  const format = await sharp(image, { limitInputPixels: false })
    .metadata()
    .then((m) => m.format)
    .catch(() => undefined)
  if (!format) return 'application/octet-stream'
  return format === 'jpeg' ? 'image/jpeg' : format === 'svg' ? 'image/svg+xml' : `image/${format}`
}
