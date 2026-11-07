import sharp from 'sharp'
import type { ContentScanner, FrameScan } from './media.service.js'

/**
 * The Match operation of Microsoft's PhotoDNA Cloud Service, as its public
 * documentation describes it. Check the address, the status codes and the
 * size limits below against the documentation that comes with the approved
 * key before switching it on: anything unexpected makes every upload wait.
 */
export const PHOTODNA_MATCH_URL = 'https://api.microsoftmoderator.com/photodna/v1.0/Match'
const OK = 3000
// The service refuses images smaller than this on either side.
const MIN_EDGE = 160
// Hashes survive resizing, so large images are sent smaller to keep requests quick.
const MAX_EDGE = 2048
/** Requests in flight at once while scanning the frames of an animation. */
const SCAN_CONCURRENCY = 4
const MAX_INPUT_PIXELS = 40_000_000

type MatchResponse = { Status?: { Code?: number; Description?: string }; IsMatch?: boolean }

/**
 * Hash-matches an upload against PhotoDNA's lists of known child sexual abuse
 * material. Throws whenever it does not get a clear answer, so the upload
 * waits rather than being published unchecked.
 */
export class PhotoDnaScanner implements ContentScanner {
  constructor(
    private readonly key: string,
    private readonly url: string = PHOTODNA_MATCH_URL,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async scan(image: Buffer): Promise<'clear' | 'match'> {
    const { pages, jpeg } = await frameSource(image)
    for (let from = 0; from < pages; from += SCAN_CONCURRENCY) {
      const batch = Array.from({ length: Math.min(SCAN_CONCURRENCY, pages - from) }, (_, i) => from + i)
      const results = await Promise.all(batch.map(async (page) => this.matches(await jpeg(page))))
      if (results.includes(true)) return 'match'
    }
    return 'clear'
  }

  /**
   * Sampled frames of a video, two requests at a time (PhotoDNA's rate limit is not
   * published). Stops at the first batch with a match. A frame that gets no clear
   * answer throws, and the video is not published.
   */
  async scanFrames(frames: Buffer[]): Promise<FrameScan> {
    for (let i = 0; i < frames.length; i += 2) {
      const batch = frames.slice(i, i + 2)
      const results = await Promise.all(batch.map(async (frame) => this.matches(await normaliseFrame(frame))))
      const hit = results.indexOf(true)
      if (hit >= 0) return { verdict: 'match', matchIndex: i + hit }
    }
    return { verdict: 'clear', matchIndex: null }
  }

  private async matches(jpeg: Buffer): Promise<boolean> {
    const res = await this.fetchFn(`${this.url}?enhance=false`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': this.key, 'content-type': 'image/jpeg' },
      body: new Uint8Array(jpeg),
      signal: AbortSignal.timeout(20_000),
    })
    const body = (await res.json().catch(() => null)) as MatchResponse | null
    if (!res.ok || body?.Status?.Code !== OK || typeof body.IsMatch !== 'boolean') {
      throw new Error(`PhotoDNA gave no answer (HTTP ${res.status}, status ${body?.Status?.Code ?? '?'}: ${body?.Status?.Description ?? 'no description'})`)
    }
    return body.IsMatch
  }
}

/** One still frame as a JPEG within the service's sizes. */
export async function normaliseFrame(image: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(image, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer({ resolveWithObject: true })
  const sized = sharp(data)
  if (Math.min(info.width, info.height) < MIN_EDGE) sized.resize(MIN_EDGE, MIN_EDGE, { fit: 'outside' })
  else if (Math.max(info.width, info.height) > MAX_EDGE) sized.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside' })
  return sized.jpeg({ quality: 90 }).toBuffer()
}

/**
 * Every frame of the image as a JPEG for matching, since an animation is
 * published frame by frame. Each is upright and within the service's sizes.
 */
export async function framesToScan(image: Buffer): Promise<Buffer[]> {
  const { pages, jpeg } = await frameSource(image)
  return Promise.all(Array.from({ length: pages }, (_, page) => jpeg(page)))
}

/**
 * The frames of an image, each as a JPEG on request. An animation is decoded once and
 * sliced: asking sharp for page N decodes every page before it, so doing that per frame
 * made a 300-frame GIF take about 12 times longer (16 s against 1.3 s at the size limit).
 */
async function frameSource(image: Buffer): Promise<{ pages: number; jpeg: (page: number) => Promise<Buffer> }> {
  const meta = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  const pages = meta.pages ?? 1
  const perPage = { pages, jpeg: (page: number) => frameJpeg(image, page) }
  // A turn from EXIF is applied per page; the raw bytes below no longer carry it.
  if (pages === 1 || (meta.orientation ?? 1) !== 1) return perPage

  const { data, info } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS, animated: true }).raw().toBuffer({ resolveWithObject: true })
  const height = info.pageHeight ?? info.height
  // Every frame is scanned or none is trusted: a different count falls back to the slow way.
  if (Math.round(info.height / height) !== pages) return perPage
  const size = info.width * height * info.channels
  const raw = { width: info.width, height, channels: info.channels }
  return {
    pages,
    jpeg: (page) => toScanJpeg(sharp(data.subarray(page * size, (page + 1) * size), { raw }), info.width, height),
  }
}

async function frameJpeg(image: Buffer, page: number): Promise<Buffer> {
  const frame = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS, page, pages: 1 }).rotate().png().toBuffer({ resolveWithObject: true })
  return toScanJpeg(sharp(frame.data), frame.info.width, frame.info.height)
}

async function toScanJpeg(sized: ReturnType<typeof sharp>, width: number, height: number): Promise<Buffer> {
  if (Math.min(width, height) < MIN_EDGE) sized.resize(MIN_EDGE, MIN_EDGE, { fit: 'outside' })
  else if (Math.max(width, height) > MAX_EDGE) sized.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside' })
  return sized.jpeg({ quality: 90 }).toBuffer()
}
