// The decision proxy.ts makes about /gists/*, kept free of Next so it can be tested.
// It fails CLOSED: anything but a clear "yes, this member is on the Gists list" is
// a no, and a no looks exactly like a URL that does not exist (docs/adr/0017 section 7).

export const SESSION_COOKIE = 'hn_session'

/**
 * The Cookie header to send for this session value, or null if it cannot be one.
 * Kratos session cookies are plain visible ASCII; anything else (a stray euro sign,
 * a NUL, a gist or a semicolon) is not a session, and putting it in a header would throw.
 */
export function sessionCookieHeader(value: string | undefined): string | null {
  if (!value || !/^[\x21-\x7e]+$/.test(value) || /[;,"\\]/.test(value)) return null
  return `${SESSION_COOKIE}=${value}`
}

export type GatedFeature = 'gists' | 'calls'

/** What GET /v1/me must answer for the member to be shown a feature: 200 and `features[feature] === true`. */
export function meAllowsFeature(feature: GatedFeature, status: number, body: unknown): boolean {
  if (status !== 200 || typeof body !== 'object' || body === null) return false
  const features = (body as { features?: unknown }).features
  return typeof features === 'object' && features !== null && (features as Record<string, unknown>)[feature] === true
}

/** What GET /v1/me must answer for the member to be shown Gists: 200 and `features.gists === true`. */
export const meAllowsGists = (status: number, body: unknown) => meAllowsFeature('gists', status, body)

type AskMe = (cookie: string) => Promise<{ status: number; json: () => Promise<unknown> }>

/** 'allow' to let the page run; 'deny' to answer as for a missing URL. Never throws. */
export async function featureGate(feature: GatedFeature, session: string | undefined, askMe: AskMe): Promise<'allow' | 'deny'> {
  const cookie = sessionCookieHeader(session)
  if (!cookie) return 'deny'
  try {
    const res = await askMe(cookie)
    return meAllowsFeature(feature, res.status, await res.json()) ? 'allow' : 'deny'
  } catch {
    // The API is down, slow, or answered with something that is not JSON.
    return 'deny'
  }
}

export const gistsGate = (session: string | undefined, askMe: AskMe) => featureGate('gists', session, askMe)
export const callsGate = (session: string | undefined, askMe: AskMe) => featureGate('calls', session, askMe)
