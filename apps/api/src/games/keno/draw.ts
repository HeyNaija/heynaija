import { createHash, createHmac, randomBytes } from 'node:crypto'

// How a Keno round's numbers come from its seed (docs/adr/0028, phase 4). The web
// app's checker (apps/web/app/(main)/games/keno/_components/fair.ts) does the same
// steps in the browser; both are tested against the same examples, so change
// neither without the other, and never for a round already drawn.

/** Numbers 1 to 80; 20 drawn a round. */
export const KENO_MAX = 80
export const KENO_DRAWN = 20
/** Values at or above this are thrown away, so that every number is equally likely: 4294967280 is 80 × 53687091. */
const FAIR_LIMIT = 4_294_967_280

/** A new secret seed: 32 random bytes, in hex. */
export const newSeed = (): string => randomBytes(32).toString('hex')

/** The commitment published before the round: SHA-256 of the seed's text, in hex. */
export const seedHash = (seed: string): string => createHash('sha256').update(seed, 'utf8').digest('hex')

/**
 * The 20 numbers, in the order they come out. For counter 0, 1, 2 …:
 * HMAC-SHA256 with the seed as key and "<round>:<counter>" as message, read as
 * eight unsigned 32-bit big-endian numbers; each below FAIR_LIMIT gives
 * (value mod 80) + 1, skipping any already drawn, until there are 20.
 */
export function drawNumbers(seed: string, round: number): number[] {
  const drawn: number[] = []
  for (let counter = 0; drawn.length < KENO_DRAWN; counter++) {
    const block = createHmac('sha256', seed).update(`${round}:${counter}`, 'utf8').digest()
    for (let i = 0; i < 32 && drawn.length < KENO_DRAWN; i += 4) {
      const value = block.readUInt32BE(i)
      if (value >= FAIR_LIMIT) continue
      const n = (value % KENO_MAX) + 1
      if (!drawn.includes(n)) drawn.push(n)
    }
  }
  return drawn
}

/** How many of a ticket's numbers were drawn. */
export const hitsOf = (picks: readonly number[], drawn: readonly number[]): number => picks.filter((n) => drawn.includes(n)).length
