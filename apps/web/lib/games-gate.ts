// The decision proxy.ts makes about /games/*, kept free of Next so it can be tested.
// It follows the rule every page and link of HeyNaija follows (docs/deployment/app-links.md):
// someone signed out is asked to sign in, then comes straight back; a member Games is
// not open to is told so. Neither sees "page not found". It still fails CLOSED: the
// page itself runs only on a clear "yes, this member may see Games" (docs/adr/0028).
import { sessionCookieHeader } from './gists-gate.ts'

type Answer = { status: number; json: () => Promise<unknown> }

/**
 * - `allow`: let the page run.
 * - `sign-in`: no session, or one that has ended: sign in first, then back here.
 * - `not-open`: a member Games is not open to (not on its list, or Games is off).
 * - `unavailable`: the API did not give a clear answer, so nothing can be shown yet.
 */
export type GamesVerdict = 'allow' | 'sign-in' | 'not-open' | 'unavailable'

/** What GET /v1/me must answer for the member to be shown Games: 200 and `features.games === true`. */
export function meAllowsGames(status: number, body: unknown): boolean {
  if (status !== 200 || typeof body !== 'object' || body === null) return false
  const features = (body as { features?: unknown }).features
  return typeof features === 'object' && features !== null && (features as { games?: unknown }).games === true
}

/** Never throws. `askMe` is GET /v1/me with the session. */
export async function gamesGate(session: string | undefined, askMe: (cookie: string) => Promise<Answer>): Promise<GamesVerdict> {
  const cookie = sessionCookieHeader(session)
  if (!cookie) return 'sign-in'
  try {
    const res = await askMe(cookie)
    // 401 is a session that has ended or was never one: the same as none.
    if (res.status === 401) return 'sign-in'
    // 403: signed in, but the API refuses them (suspended, or never invited): no Games either.
    if (res.status === 403) return 'not-open'
    if (res.status !== 200) return 'unavailable'
    return meAllowsGames(res.status, await res.json()) ? 'allow' : 'not-open'
  } catch {
    // The API is down, slow, or answered with something that is not JSON.
    return 'unavailable'
  }
}

/**
 * The Games address to come back to after signing in (a path under /games, with its
 * query), or null if `to` is not one. Only ever a path on this site.
 */
export function gamesReturnPath(to: unknown): string | null {
  if (typeof to !== 'string' || to.length > 500) return null
  if (!/^\/games(?:[/?]|$)/.test(to)) return null
  // No second slash or backslash that could make it another site, nothing but printable ASCII.
  if (/\/\/|\\/.test(to) || !/^[\x21-\x7e]+$/.test(to)) return null
  return to
}
