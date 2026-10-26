import sharp from 'sharp'
import type { ContentScanner } from './media.service.js'

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
/** Frames of an animation that are scanned, spread evenly from the first to the last. */
export const MAX_SCANNED_FRAMES = 20

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
    for (const frame of await framesToScan(image)) {
      if (await this.matches(frame)) return 'match'
    }
    return 'clear'
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

/**
 * The image as the JPEGs that are sent for matching: a still image once, an
 * animation as a spread of its frames (the first always among them, since that
 * is also the still we publish). Each is upright and within the service's sizes.
 */
export async function framesToScan(image: Buffer): Promise<Buffer[]> {
  const limitInputPixels = 40_000_000
  const pages = (await sharp(image, { limitInputPixels }).metadata()).pages ?? 1
  const picks =
    pages <= MAX_SCANNED_FRAMES
      ? Array.from({ length: pages }, (_, i) => i)
      : Array.from({ length: MAX_SCANNED_FRAMES }, (_, i) => Math.round((i * (pages - 1)) / (MAX_SCANNED_FRAMES - 1)))
  return Promise.all(
    picks.map(async (page) => {
      const frame = await sharp(image, { limitInputPixels, page, pages: 1 }).rotate().png().toBuffer({ resolveWithObject: true })
      const { width, height } = frame.info
      const sized = sharp(frame.data)
      if (Math.min(width, height) < MIN_EDGE) sized.resize(MIN_EDGE, MIN_EDGE, { fit: 'outside' })
      else if (Math.max(width, height) > MAX_EDGE) sized.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside' })
      return sized.jpeg({ quality: 90 }).toBuffer()
    }),
  )
}
