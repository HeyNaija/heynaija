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

/**
 * What a link turns off: 'unsubscribe' is email notifications (the name it has
 * had since the first emails, so old links keep working), 'highlights' the
 * weekly highlights (ADR 0027). A link for one is not a link for the other.
 */
export type UnsubscribeFrom = 'unsubscribe' | 'highlights'

const sign = (key: Buffer, memberId: string, from: UnsubscribeFrom): string =>
  createHmac('sha256', key).update(`${from}:${memberId}`).digest('base64url')

/**
 * A link that turns one kind of message off for one member and does nothing
 * else: their ID and a signature over it. It carries no login and does not
 * expire (an email can be opened months later, and the worst a stolen link can
 * do is switch one member's email off).
 */
export const unsubscribeToken = (key: Buffer, memberId: string, from: UnsubscribeFrom = 'unsubscribe'): string =>
  `${memberId}.${sign(key, memberId, from)}`

/** The member a token was made for, or null if it is not one of ours, or turns off something else. */
export function memberOfUnsubscribeToken(key: Buffer, token: string, from: UnsubscribeFrom = 'unsubscribe'): string | null {
  const parts = token.split('.')
  const [memberId, signature] = parts
  if (parts.length !== 2 || !memberId || !signature || !UUID.test(memberId)) return null
  const expected = Buffer.from(sign(key, memberId, from))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given) ? memberId : null
}
