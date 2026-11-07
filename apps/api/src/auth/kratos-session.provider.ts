import { Inject, Injectable } from '@nestjs/common'
import type { AuthRequest, AuthSessionProvider, MemberIdentity } from './auth-session.provider.js'
import { KratosAdmin } from './kratos-admin.js'
import { KratosService, SESSION_COOKIE, type SessionVia } from './kratos.service.js'

/**
 * The session cookie exactly as the browser sent it: Kratos compares it byte for
 * byte, so it is not decoded. Two of them are ambiguous, so neither is used.
 */
function sessionCookie(request: AuthRequest): string | undefined {
  const matches = (request.cookieHeader ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
  if (matches.length !== 1) return undefined
  return matches[0]!.slice(SESSION_COOKIE.length + 1) || undefined
}

/**
 * The session token the Android and iOS apps send as `Authorization: Bearer
 * <token>`: Kratos's native flows give them a token where a browser gets a cookie.
 */
function sessionToken(request: AuthRequest): string | undefined {
  return /^Bearer (\S+)$/.exec(request.authorization ?? '')?.[1]
}

/** The request's session: the apps' token, or else the browser's cookie. */
function sessionOf(request: AuthRequest): { secret: string; via: SessionVia } | undefined {
  const token = sessionToken(request)
  if (token) return { secret: token, via: 'token' }
  const cookie = sessionCookie(request)
  return cookie ? { secret: cookie, via: 'cookie' } : undefined
}

/** Kratos behind AuthService: a session is its `hn_session` cookie, or a session token from the apps. */
@Injectable()
export class KratosSessionProvider implements AuthSessionProvider {
  constructor(
    @Inject(KratosService)
    private readonly kratos: Pick<KratosService, 'identityForSession' | 'forgetSession' | 'emailForSession' | 'authenticatedAtForSession'>,
    @Inject(KratosAdmin)
    private readonly admin: Pick<KratosAdmin, 'revokeAllSessions' | 'deactivateIdentity' | 'deleteIdentity' | 'identityIdByEmail'>,
  ) {}

  async identityForRequest(request: AuthRequest): Promise<MemberIdentity | null> {
    const session = sessionOf(request)
    return session ? this.kratos.identityForSession(session.secret, session.via) : null
  }

  async invalidateSessionCache(request: AuthRequest): Promise<void> {
    const session = sessionOf(request)
    if (session) await this.kratos.forgetSession(session.secret, session.via)
  }

  async emailForRequest(request: AuthRequest): Promise<string | null> {
    const session = sessionOf(request)
    return session ? this.kratos.emailForSession(session.secret, session.via) : null
  }

  async authenticatedAtForRequest(request: AuthRequest): Promise<Date | null> {
    const session = sessionOf(request)
    return session ? this.kratos.authenticatedAtForSession(session.secret, session.via) : null
  }

  revokeAllSessions(memberId: string): Promise<void> {
    return this.admin.revokeAllSessions(memberId)
  }

  deactivateIdentity(memberId: string): Promise<void> {
    return this.admin.deactivateIdentity(memberId)
  }

  deleteIdentity(memberId: string): Promise<void> {
    return this.admin.deleteIdentity(memberId)
  }

  identityIdByEmail(email: string): Promise<string | null> {
    return this.admin.identityIdByEmail(email)
  }
}
