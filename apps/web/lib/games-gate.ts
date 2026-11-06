// The decision proxy.ts makes about /games/*, kept free of Next so it can be tested.
// Like the Gists gate it fails CLOSED: anything but a clear "yes, this member may
// see Games" looks exactly like a URL that does not exist (docs/adr/0018). Games
// is for members on its list only, so a visitor with no session always gets the
// missing page.
import { sessionCookieHeader } from './gists-gate.ts'

type Answer = { status: number; json: () => Promise<unknown> }

/** What GET /v1/me must answer for the member to be shown Games: 200 and `features.games === true`. */
export function meAllowsGames(status: number, body: unknown): boolean {
  if (status !== 200 || typeof body !== 'object' || body === null) return false
  const features = (body as { features?: unknown }).features
  return typeof features === 'object' && features !== null && (features as { games?: unknown }).games === true
}

/** 'allow' to let the page run, 'deny' to answer as for a missing URL. Never throws. `askMe` is GET /v1/me with the session. */
export async function gamesGate(session: string | undefined, askMe: (cookie: string) => Promise<Answer>): Promise<'allow' | 'deny'> {
  const cookie = sessionCookieHeader(session)
  if (!cookie) return 'deny'
  try {
    const res = await askMe(cookie)
    return meAllowsGames(res.status, await res.json()) ? 'allow' : 'deny'
  } catch {
    // The API is down, slow, or answered with something that is not JSON.
    return 'deny'
  }
}
