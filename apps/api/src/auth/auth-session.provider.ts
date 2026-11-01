/** The credentials AuthService reads from a request. Secret: never log or return them. */
export type AuthRequest = { cookieHeader?: string }

/** Who is signed in, as the app sees it: `id` is the member ID. */
export type MemberIdentity = { id: string; handle: string }

/**
 * The authentication backend behind AuthService (docs/adr/0012). Kratos is the
 * only one; this is the seam a replacement would fill.
 */
export interface AuthSessionProvider {
  /** The signed-in member, or null if the request has no live session. */
  identityForRequest(request: AuthRequest): Promise<MemberIdentity | null>
  /** Stops reusing a cached lookup for this session. It does not end the session. */
  invalidateSessionCache(request: AuthRequest): Promise<void>
  /** The account's email, asked of the backend afresh. Null if the session has ended. */
  emailForRequest(request: AuthRequest): Promise<string | null>
  /**
   * When the member last proved who they are on this session (signed in, or
   * signed in again), asked of the backend afresh. Null if the session has ended.
   */
  authenticatedAtForRequest(request: AuthRequest): Promise<Date | null>
  /** Ends every session the member has, everywhere. Safe to repeat. */
  revokeAllSessions(memberId: string): Promise<void>
  /** Switches the sign-in account off: no signing in, and no address for emails. Safe to repeat. */
  deactivateIdentity(memberId: string): Promise<void>
  /** Deletes the member's sign-in account, with any session left. Safe to repeat. */
  deleteIdentity(memberId: string): Promise<void>
  /** The member whose account email this is, in any case, or null. For operators. */
  identityIdByEmail(email: string): Promise<string | null>
}

export const AUTH_SESSION_PROVIDER = Symbol('AUTH_SESSION_PROVIDER')

/**
 * The backend could not answer (`unavailable`) or answered something unexpected
 * (`protocol`). Never the same as rejecting the credentials: that is a null.
 */
export class AuthProviderError extends Error {
  constructor(readonly kind: 'unavailable' | 'protocol') {
    super(`authentication provider ${kind}`)
  }
}
