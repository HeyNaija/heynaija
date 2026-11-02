import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import {
  AUTH_SESSION_PROVIDER,
  AuthProviderError,
  type AuthRequest,
  type AuthSessionProvider,
  type MemberIdentity,
} from './auth-session.provider.js'

export type { AuthRequest, MemberIdentity }

/** The credentials AuthService needs from an incoming request. */
export const authRequest = (req: Pick<FastifyRequest, 'headers'>): AuthRequest => ({ cookieHeader: req.headers.cookie })

/**
 * The API's one way to ask who is signed in (docs/adr/0012). Guards and
 * controllers use this, never Kratos, its cookie or its responses directly.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(@Inject(AUTH_SESSION_PROVIDER) private readonly provider: AuthSessionProvider) {}

  identityForRequest(request: AuthRequest): Promise<MemberIdentity | null> {
    return this.providerCall(() => this.provider.identityForRequest(request))
  }

  invalidateSessionCache(request: AuthRequest): Promise<void> {
    return this.providerCall(() => this.provider.invalidateSessionCache(request))
  }

  emailForRequest(request: AuthRequest): Promise<string | null> {
    return this.providerCall(() => this.provider.emailForRequest(request))
  }

  /** When the member last signed in, or signed in again, on this session: for steps that need a recent sign-in. */
  authenticatedAtForRequest(request: AuthRequest): Promise<Date | null> {
    return this.providerCall(() => this.provider.authenticatedAtForRequest(request))
  }

  // Account deletion (docs/adr/0016). Each is safe to repeat.

  revokeAllSessions(memberId: string): Promise<void> {
    return this.providerCall(() => this.provider.revokeAllSessions(memberId))
  }

  deactivateIdentity(memberId: string): Promise<void> {
    return this.providerCall(() => this.provider.deactivateIdentity(memberId))
  }

  deleteIdentity(memberId: string): Promise<void> {
    return this.providerCall(() => this.provider.deleteIdentity(memberId))
  }

  identityIdByEmail(email: string): Promise<string | null> {
    return this.providerCall(() => this.provider.identityIdByEmail(email))
  }

  // A backend that is down or answers nonsense is a 503, so a protected route
  // fails instead of treating the member as signed out.
  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof AuthProviderError)) throw error
      this.logger.warn(`authentication provider ${error.kind}`)
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'authentication service unavailable',
        code: `auth_provider_${error.kind}`,
      })
    }
  }
}
