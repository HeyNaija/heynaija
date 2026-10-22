import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { AuthAccountProvider } from './auth-account.provider.js'
import type { AuthFlowProvider, AuthFlowRequest, AuthRedirect } from './auth-flow.provider.js'
import { KratosService } from './kratos.service.js'
import { KratosSessionProvider } from './kratos-session.provider.js'
import { KratosFlowProvider } from './kratos-flow.provider.js'
import { AuthProviderError, type AuthRequest } from './auth-session.provider.js'

@Injectable()
export class KratosAccountProvider implements AuthAccountProvider {
  readonly capabilities = {
    emailRead: true,
    accountChanges: true,
  } as const

  constructor(
    @Inject(KratosService) private readonly kratos: Pick<KratosService, 'emailForSession'>,
    @Inject(KratosSessionProvider) private readonly sessions: Pick<KratosSessionProvider, 'sessionCookieForRequest'>,
    @Inject(KratosFlowProvider) private readonly flows: Pick<AuthFlowProvider, 'begin'>,
  ) {}

  async emailForRequest(request: AuthRequest): Promise<string | null> {
    const cookie = this.sessions.sessionCookieForRequest(request);
    if (!cookie) return null
    try {
      return await this.kratos.emailForSession(cookie);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw new AuthProviderError('unavailable');
      throw error;
    }
  }

  beginAccountChange(request: AuthFlowRequest): Promise<AuthRedirect> {
    return this.flows.begin('settings', request)
  }
}
