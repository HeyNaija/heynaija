// Checks a Keno round in the browser (docs/adr/0028, phase 4), with the same steps
// the API draws by (apps/api/src/games/keno/draw.ts). Both are tested against the
// same examples; change neither without the other.

const FAIR_LIMIT = 4_294_967_280
const text = new TextEncoder()

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

/** SHA-256 of the seed's text, in hex: what was published before the round. */
export async function seedHash(seed: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', text.encode(seed)))
}

/** The 20 numbers the seed gives for the round, in the order they come out. */
export async function drawNumbers(seed: string, round: number): Promise<number[]> {
  const key = await crypto.subtle.importKey('raw', text.encode(seed), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const drawn: number[] = []
  for (let counter = 0; drawn.length < 20; counter++) {
    const block = new DataView(await crypto.subtle.sign('HMAC', key, text.encode(`${round}:${counter}`)))
    for (let i = 0; i < 32 && drawn.length < 20; i += 4) {
      const value = block.getUint32(i)
      if (value >= FAIR_LIMIT) continue
      const n = (value % 80) + 1
      if (!drawn.includes(n)) drawn.push(n)
    }
  }
  return drawn
}

/** Whether the round's published hash and numbers are the ones its seed gives. */
export async function checkRound(r: { number: number; seedHash: string; seed: string; numbers: number[] }): Promise<{ hashMatches: boolean; numbersMatch: boolean }> {
  const [hash, numbers] = await Promise.all([seedHash(r.seed), drawNumbers(r.seed, r.number)])
  return { hashMatches: hash === r.seedHash, numbersMatch: numbers.length === r.numbers.length && numbers.every((n, i) => n === r.numbers[i]) }
}
