import { createHmac, timingSafeEqual } from 'node:crypto'

/** Didit rejects a delivery whose X-Timestamp is further than this from now (docs.didit.me/integration/webhooks). */
export const MAX_SKEW_S = 300

export type SignatureResult = { ok: true } | { ok: false; reason: 'bad_timestamp' | 'stale' | 'missing_signature' | 'bad_signature' }

/** Whole-valued floats are written as ints by Didit's canonical form. JSON.parse already loses the difference (85.0 is 85), so only sorting is left. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

const one = (header: string | string[] | undefined): string | undefined => (Array.isArray(header) ? undefined : header)

function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  // timingSafeEqual needs equal lengths; the length of a hex digest is not a secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Checks a Didit webhook the way https://docs.didit.me/integration/webhooks says
 * to: X-Timestamp within 300 seconds of now (and equal to the signed body's own
 * `timestamp`, see below), then X-Signature-V2, the HMAC-SHA256
 * (hex) of the parsed body written with sorted keys, compact separators and
 * Unicode kept, compared in constant time. The docs recommend V2 because it
 * survives a framework re-encoding the body, and it covers the whole payload.
 * X-Signature (raw bytes) is not used, and X-Signature-Simple, which covers only
 * four fields and not the decision, is never accepted.
 *
 * For 24 hours after the secret is rotated Didit also sends X-Signature-V2-Previous,
 * made with the old secret; a match on either header is accepted.
 */
export function verifyDiditSignature(input: {
  body: unknown
  headers: Record<string, string | string[] | undefined>
  secret: string
  nowMs: number
}): SignatureResult {
  const stamp = one(input.headers['x-timestamp'])
  if (!stamp || !/^\d{1,12}$/.test(stamp)) return { ok: false, reason: 'bad_timestamp' }
  if (Math.abs(Math.floor(input.nowMs / 1000) - Number(stamp)) > MAX_SKEW_S) return { ok: false, reason: 'stale' }
  // X-Timestamp is not covered by the signature, so on its own it proves nothing: an old signed
  // body could be sent again with a fresh header. The body's own `timestamp` is signed, so it
  // must equal the header. That makes the 300 second window bind the body too.
  const signedAt = input.body !== null && typeof input.body === 'object' ? (input.body as Record<string, unknown>).timestamp : undefined
  if (typeof signedAt !== 'number' || signedAt !== Number(stamp)) return { ok: false, reason: 'bad_timestamp' }

  const given = [input.headers['x-signature-v2'], input.headers['x-signature-v2-previous']].filter(
    (h): h is string | string[] => h !== undefined && h !== '',
  )
  if (given.length === 0) return { ok: false, reason: 'missing_signature' }

  const expected = createHmac('sha256', input.secret).update(JSON.stringify(canonical(input.body)), 'utf8').digest('hex')
  // Check every header, so that the time taken does not say which one matched.
  let matched = false
  for (const header of given) {
    const value = one(header)
    if (value !== undefined && sameHex(expected, value)) matched = true
  }
  return matched ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

/** For tests and tools that sign a delivery the documented way. */
export const signDiditBody = (body: unknown, secret: string): string =>
  createHmac('sha256', secret).update(JSON.stringify(canonical(body)), 'utf8').digest('hex')
