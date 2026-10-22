import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { AuthProviderError, type AuthenticationResult, type AuthRequest, type AuthSessionProvider } from './auth-session.provider.js'
import { KratosService, SESSION_COOKIE } from './kratos.service.js'

/** Preserve cookie bytes: decoding/re-encoding can change Kratos credentials. */
function sessionCookie(request: AuthRequest): string | undefined {
  const matches = (request.cookieHeader ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`))
  // Duplicate credentials are ambiguous; do not select one arbitrarily.
  if (matches.length !== 1) return undefined
  return matches[0]!.slice(SESSION_COOKIE.length + 1) || undefined
}

@Injectable()
export class KratosSessionProvider implements AuthSessionProvider {
  constructor(@Inject(KratosService) private readonly kratos: Pick<KratosService, 'identityForSession' | 'forgetSession'>) {}

  hasCredentials(request: AuthRequest): boolean {
    return (request.cookieHeader ?? '').split(';')
      .some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`))
  }

  sessionCookieForRequest(request: AuthRequest): string | undefined {
    return sessionCookie(request)
  }

  async authenticate(request: AuthRequest): Promise<AuthenticationResult> {
    const cookie = sessionCookie(request)
    if (!cookie) return { status: 'anonymous' }
    try {
      const identity = await this.kratos.identityForSession(cookie)
      return identity
        ? { status: 'authenticated', identity: { providerId: 'kratos', subject: identity.id, providerKind: 'kratos', details: identity } }
        : { status: 'anonymous' }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw new AuthProviderError('unavailable')
      throw error
    }
  }

  async invalidateSessionCache(request: AuthRequest): Promise<void> {
    const cookie = sessionCookie(request)
    if (cookie) await this.kratos.forgetSession(cookie)
  }

}
