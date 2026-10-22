import { Inject, Injectable, Logger, NotImplementedException, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { AUTH_DEFAULT_PROVIDER, type AuthFlowKind, type AuthFlowRequest } from './auth-flow.provider.js'
import { AUTH_SESSION_PROVIDERS, AuthProviderError, type AuthRequest, type AuthSessionProviders } from './auth-session.provider.js'
import type { AuthLifecycleProvider, RegistrationCallback, SettingsCallback } from './auth-lifecycle.provider.js'
import { IdentityMappingService } from './identity-mapping.service.js'

/** The existing application identity, independent of provider response types. */
export type MemberIdentity = { id: string; handle: string }

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @Inject(AUTH_SESSION_PROVIDERS) private readonly providers: AuthSessionProviders,
    @Inject(AUTH_DEFAULT_PROVIDER) private readonly defaultProvider = 'kratos',
    @Optional() @Inject(IdentityMappingService) private readonly mappings?: IdentityMappingService,
  ) {}

  async identityForRequest(request: AuthRequest): Promise<MemberIdentity | null> {
    return this.providerCall(async () => {
      const selected = this.selectProvider(request)
      if (!selected) return null
      const [providerId, provider] = selected
      const result = await provider.authenticate(request)
      if (result.status === 'anonymous') return null
      if (result.identity.providerId !== providerId) throw new AuthProviderError('protocol')
      if (providerId !== 'kratos' || result.identity.providerKind !== 'kratos') throw new AuthProviderError('protocol')
      const mapped = this.mappings ? await this.mappings.resolve(providerId, result.identity.subject) : null
      // Legacy fallback remains until the application cutover is explicitly
      // marked. It preserves existing and newly-created Kratos accounts while
      // the backfill is being deployed.
      return { id: mapped ?? result.identity.subject, handle: result.identity.details.handle }
    })
  }

  async invalidateSessionCache(request: AuthRequest): Promise<void> {
    await this.providerCall(async () => {
      const selected = this.selectProvider(request)
      if (selected) await selected[1].invalidateSessionCache(request)
    })
  }

  async emailForRequest(request: AuthRequest): Promise<string | null> {
    return this.providerCall(async () => {
      const selected = this.selectProvider(request)
      if (!selected) return null
      const provider = selected[1]
      if (!provider.account?.capabilities.emailRead) {
        throw new NotImplementedException({ statusCode: 501, message: 'account email lookup is unsupported', code: 'auth_operation_unsupported' })
      }
      return provider.account.emailForRequest(request)
    })
  }

  beginFlow(kind: AuthFlowKind, request: AuthFlowRequest) {
    return this.providerCall(() => this.flowProvider(request).begin(kind, request))
  }

  resumeFlow(kind: AuthFlowKind, id: string, request: AuthFlowRequest) {
    return this.providerCall(() => this.flowProvider(request).resume(kind, id, request))
  }

  reauthenticate(request: AuthFlowRequest) {
    return this.providerCall(() => this.flowProvider(request).reauthenticate(request))
  }

  submitFlow(kind: AuthFlowKind, id: string, form: string, request: AuthFlowRequest) {
    return this.providerCall(() => this.flowProvider(request).submit(kind, id, form, request))
  }

  /** Email, handle and connected-account changes use a provider-owned settings flow. */
  beginAccountChange(request: AuthFlowRequest) {
    return this.providerCall(() => {
      this.flowProvider(request)
      const provider = this.selectProvider(request)?.[1] ?? this.providers[this.defaultProvider]
      if (!provider?.account?.capabilities.accountChanges) throw new NotImplementedException('account changes are unsupported')
      return provider.account.beginAccountChange(request)
    })
  }

  logoutUrl(request: AuthFlowRequest) {
    return this.providerCall(() => this.flowProvider(request).logoutUrl(request))
  }

  completeLogout(token: string, request: AuthFlowRequest) {
    return this.providerCall(async () => {
      const provider = this.flowProvider(request)
      // Best effort, as in the old web logout route. Provider revocation must
      // still run if the cache is down; a retained cache entry expires by TTL.
      await this.invalidateSessionCache(request).catch(() => undefined)
      const redirect = await provider.logout(token, request)
      await this.invalidateSessionCache(request).catch(() => undefined)
      return redirect
    })
  }

  flowError(id: string, request: AuthFlowRequest) {
    return this.providerCall(() => this.flowProvider(request).error(id))
  }

  async registrationCallback(providerId: string, body: unknown): Promise<RegistrationCallback | null> {
    return this.lifecycleProvider(providerId)?.registration(body) ?? null
  }

  async settingsCallback(providerId: string, body: unknown): Promise<SettingsCallback | null> {
    return this.lifecycleProvider(providerId)?.settings(body) ?? null
  }

  private lifecycleProvider(providerId: string): AuthLifecycleProvider | undefined {
    return this.providers[providerId]?.lifecycle
  }

  private flowProvider(request: AuthFlowRequest) {
    // Flow IDs are still provider-owned, not bound by an application flow store.
    // Refuse multiple flow backends until that binding is implemented (stage 5).
    if (Object.values(this.providers).filter((provider) => provider.flows).length > 1) {
      throw new NotImplementedException('multiple flow providers require interaction binding')
    }
    const selected = this.selectProvider(request)
    const provider = selected?.[1] ?? this.providers[this.defaultProvider]
    if (!provider?.flows) throw new NotImplementedException('authentication flows are unsupported')
    return provider.flows
  }

  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof AuthProviderError) {
        this.logger.warn(`authentication provider ${error.kind}`)
        throw new ServiceUnavailableException({
          statusCode: 503,
          message: 'authentication service unavailable',
          code: `auth_provider_${error.kind}`,
        })
      }
      throw error
    }
  }

  private selectProvider(request: AuthRequest) {
    const matches = Object.entries(this.providers).filter(([, provider]) => provider.hasCredentials(request))
    if (matches.length > 1) {
      throw new UnauthorizedException({ statusCode: 401, message: 'conflicting authentication credentials', code: 'auth_provider_conflict' })
    }
    return matches[0]
  }
}
