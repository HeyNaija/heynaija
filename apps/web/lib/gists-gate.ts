// The decision proxy.ts makes about /gists/*, kept free of Next so it can be tested.
// It fails CLOSED: anything but a clear "yes, this member is on the Gists list" is
// a no, and a no looks exactly like a URL that does not exist (docs/adr/0017 section 4a).
// The one exception is a visitor with no session, at a Gist's address, while Gists
// are on: they are asked to sign in first, the same for every Gist address, real or
// not, so it says nothing about any Gist.

export const SESSION_COOKIE = 'hn_session'

type Answer = { status: number; json: () => Promise<unknown> }

/**
 * The Cookie header to send for this session value, or null if it cannot be one.
 * Kratos session cookies are plain visible ASCII; anything else (a stray euro sign,
 * a NUL, a gist or a semicolon) is not a session, and putting it in a header would throw.
 */
export function sessionCookieHeader(value: string | undefined): string | null {
  if (!value || !/^[\x21-\x7e]+$/.test(value) || /[;,"\\]/.test(value)) return null
  return `${SESSION_COOKIE}=${value}`
}

/** What GET /v1/me must answer for the member to be shown Gists: 200 and `features.gists === true`. */
export function meAllowsGists(status: number, body: unknown): boolean {
  if (status !== 200 || typeof body !== 'object' || body === null) return false
  const features = (body as { features?: unknown }).features
  return typeof features === 'object' && features !== null && (features as { gists?: unknown }).gists === true
}

/**
 * 'allow' to let the page run; 'sign-in' to ask someone with no session to sign in
 * and come back; 'deny' to answer as for a missing URL. Never throws.
 *
 * `askMe` is GET /v1/me with the session. `askGists` is a Gists route asked with no
 * session: the API checks the switch before sign-in, so it answers 401 while Gists
 * are on and 404 (the words of a missing route) while they are off. With them off,
 * a signed-out visitor still gets the missing page.
 */
export async function gistsGate(
  session: string | undefined,
  askMe: (cookie: string) => Promise<Answer>,
  askGists: () => Promise<Pick<Answer, 'status'>>,
): Promise<'allow' | 'sign-in' | 'deny'> {
  const cookie = sessionCookieHeader(session)
  try {
    if (cookie) {
      const res = await askMe(cookie)
      // 401 is a session that has ended or was never one: the same as none.
      if (res.status !== 401) return meAllowsGists(res.status, await res.json()) ? 'allow' : 'deny'
    }
    return (await askGists()).status === 401 ? 'sign-in' : 'deny'
  } catch {
    // The API is down, slow, or answered with something that is not JSON.
    return 'deny'
  }
}

/** The Gist address (`/gists/<uuid>`) to send a visitor back to after signing in, or null if `path` is not one. */
export function gistReturnPath(path: unknown): string | null {
  return typeof path === 'string' && /^\/gists\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path) ? path : null
}
