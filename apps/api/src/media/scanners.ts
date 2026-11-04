import { ArachnidShieldScanner } from './arachnid-shield.js'
import { type ContentScanner, type FrameScan, NoScanner, type VideoScan } from './media.service.js'
import { PhotoDnaScanner } from './photodna.js'

/** The settings that choose the scanners: the API's and the video worker's environments both carry them. */
export type ScannerEnv = {
  PHOTODNA_SUBSCRIPTION_KEY?: string
  PHOTODNA_MATCH_URL?: string
  ARACHNID_SHIELD_USERNAME?: string
  ARACHNID_SHIELD_PASSWORD?: string
  ARACHNID_SHIELD_URL?: string
}

/**
 * Every scanner this environment has a key for, as one (docs/safety/abuse-material-scanning.md):
 * Arachnid Shield, PhotoDNA, or both. With none it is `NoScanner`: images pass, videos are held.
 */
export function scannerFromEnv(env: ScannerEnv): ContentScanner {
  const scanners: ContentScanner[] = []
  if (env.ARACHNID_SHIELD_USERNAME && env.ARACHNID_SHIELD_PASSWORD) {
    scanners.push(new ArachnidShieldScanner(env.ARACHNID_SHIELD_USERNAME, env.ARACHNID_SHIELD_PASSWORD, env.ARACHNID_SHIELD_URL))
  }
  if (env.PHOTODNA_SUBSCRIPTION_KEY) scanners.push(new PhotoDnaScanner(env.PHOTODNA_SUBSCRIPTION_KEY, env.PHOTODNA_MATCH_URL))
  if (scanners.length === 0) return new NoScanner()
  return scanners.length === 1 ? scanners[0]! : new AllScanners(scanners)
}

/** For start-up logs: which scanners are bound. */
export function describeScanner(scanner: ContentScanner): string {
  if (scanner instanceof AllScanners) return scanner.scanners.map(describeScanner).join(' + ')
  if (scanner instanceof ArachnidShieldScanner) return 'Arachnid Shield'
  if (scanner instanceof PhotoDnaScanner) return 'PhotoDNA'
  if (scanner instanceof NoScanner) return 'NONE (fail closed)'
  return scanner.constructor.name
}

/**
 * Several scanners as one: a match from any of them is a match, and any that cannot
 * answer makes the whole check throw, so nothing is published on a partial look.
 * For video each takes what it can (the whole file, or the sampled frames); one with
 * neither adds nothing, and `unscanned` comes back only when none of them looked.
 */
export class AllScanners implements ContentScanner {
  constructor(readonly scanners: ContentScanner[]) {}

  async scan(image: Buffer): Promise<'clear' | 'match'> {
    for (const scanner of this.scanners) if ((await scanner.scan(image)) === 'match') return 'match'
    return 'clear'
  }

  async scanFrames(frames: Buffer[]): Promise<FrameScan> {
    let looked = false
    for (const scanner of this.scanners) {
      if (!scanner.scanFrames) continue
      const scan = await scanner.scanFrames(frames)
      if (scan.verdict === 'match') return scan
      looked ||= scan.verdict === 'clear'
    }
    return { verdict: looked ? 'clear' : 'unscanned', matchIndex: null }
  }

  async scanVideo(video: { path: string; contentType: string }): Promise<VideoScan> {
    let looked = false
    for (const scanner of this.scanners) {
      if (!scanner.scanVideo) continue
      const scan = await scanner.scanVideo(video)
      if (scan.verdict === 'match') return scan
      looked ||= scan.verdict === 'clear'
    }
    return { verdict: looked ? 'clear' : 'unscanned', matchMs: null }
  }
}
