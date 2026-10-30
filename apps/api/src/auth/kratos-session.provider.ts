import { Inject, Injectable } from '@nestjs/common'
import type { AuthRequest, AuthSessionProvider, MemberIdentity } from './auth-session.provider.js'
import { KratosAdmin } from './kratos-admin.js'
import { KratosService, SESSION_COOKIE } from './kratos.service.js'

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

/** Kratos behind AuthService: a session is its `hn_session` cookie. */
@Injectable()
export class KratosSessionProvider implements AuthSessionProvider {
  constructor(
    @Inject(KratosService)
    private readonly kratos: Pick<KratosService, 'identityForSession' | 'forgetSession' | 'emailForSession' | 'authenticatedAtForSession'>,
    @Inject(KratosAdmin)
    private readonly admin: Pick<KratosAdmin, 'revokeAllSessions' | 'deleteIdentity' | 'identityIdByEmail'>,
  ) {}

  async identityForRequest(request: AuthRequest): Promise<MemberIdentity | null> {
    const cookie = sessionCookie(request)
    return cookie ? this.kratos.identityForSession(cookie) : null
  }

  async invalidateSessionCache(request: AuthRequest): Promise<void> {
    const cookie = sessionCookie(request)
    if (cookie) await this.kratos.forgetSession(cookie)
  }

  async emailForRequest(request: AuthRequest): Promise<string | null> {
    const cookie = sessionCookie(request)
    return cookie ? this.kratos.emailForSession(cookie) : null
  }

  async authenticatedAtForRequest(request: AuthRequest): Promise<Date | null> {
    const cookie = sessionCookie(request)
    return cookie ? this.kratos.authenticatedAtForSession(cookie) : null
  }

  revokeAllSessions(memberId: string): Promise<void> {
    return this.admin.revokeAllSessions(memberId)
  }

  deleteIdentity(memberId: string): Promise<void> {
    return this.admin.deleteIdentity(memberId)
  }

  identityIdByEmail(email: string): Promise<string | null> {
    return this.admin.identityIdByEmail(email)
  }
}
