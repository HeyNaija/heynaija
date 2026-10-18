import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The key unsubscribe links are signed with. It is derived from a secret the API
 * already has (the Kratos webhook secret) for this one purpose, so a link can
 * never be used where that secret itself is, and no new secret has to reach
 * every server before this ships. Changing the webhook secret ends old links.
 */
export const unsubscribeKey = (secret: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, 'heynaija', 'email-unsubscribe-v1', 32))

const sign = (key: Buffer, memberId: string): string =>
  createHmac('sha256', key).update(`unsubscribe:${memberId}`).digest('base64url')

/**
 * A link that turns email notifications off for one member and does nothing
 * else: their ID and a signature over it. It carries no login and does not
 * expire (an email can be opened months later, and the worst a stolen link can
 * do is switch one member's email off).
 */
export const unsubscribeToken = (key: Buffer, memberId: string): string => `${memberId}.${sign(key, memberId)}`

/** The member a token was made for, or null if it is not one of ours. */
export function memberOfUnsubscribeToken(key: Buffer, token: string): string | null {
  const parts = token.split('.')
  const [memberId, signature] = parts
  if (parts.length !== 2 || !memberId || !signature || !UUID.test(memberId)) return null
  const expected = Buffer.from(sign(key, memberId))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given) ? memberId : null
}
