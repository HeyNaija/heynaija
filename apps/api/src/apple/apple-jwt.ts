import { sign } from 'node:crypto'
import type { AppleKey } from '../env.js'

const b64url = (value: string) => Buffer.from(value).toString('base64url')

/**
 * A JWT signed with HeyNaija's Apple key (ES256, the key's ID in the header), as
 * both APNs (its provider token) and Sign in with Apple (its client secret) want
 * one. The team is the issuer; `claims` adds the rest.
 */
export function appleJwt(key: AppleKey, claims: Record<string, unknown>, now: number): string {
  const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: key.keyId }))}.${b64url(
    JSON.stringify({ iss: key.teamId, iat: Math.floor(now / 1000), ...claims }),
  )}`
  // JWTs carry ECDSA signatures as r and s side by side, not DER.
  const signature = sign('sha256', Buffer.from(unsigned), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${unsigned}.${signature}`
}
