import type { Identity as KratosIdentity } from './kratos.service.js'
import type { AuthFlowProvider } from './auth-flow.provider.js'
import type { AuthAccountProvider } from './auth-account.provider.js'
import type { AuthLifecycleProvider } from './auth-lifecycle.provider.js'

/** Server-only credentials. Never log or return these to a client. */
export type AuthRequest = {
  cookieHeader?: string
  authorizationHeader?: string
}

export type ProviderIdentity = {
  providerId: string
  subject: string
} & (
  | { providerKind: 'kratos'; details: KratosIdentity }
  // Add other provider-specific variants here.
)

export type AuthenticationResult =
  | { status: 'anonymous' }
  | { status: 'authenticated'; identity: ProviderIdentity }

export interface AuthSessionProvider {
  /** Recognises credential presence only; authentication still validates it. */
  hasCredentials(request: AuthRequest): boolean
  authenticate(request: AuthRequest): Promise<AuthenticationResult>
  /** Cache eviction only; this does not revoke a provider session. */
  invalidateSessionCache(request: AuthRequest): Promise<void>
}

export type AuthProviderEntry = AuthSessionProvider & {
  account?: AuthAccountProvider
  flows?: AuthFlowProvider
  lifecycle?: AuthLifecycleProvider
}
export type AuthSessionProviders = Readonly<Record<string, AuthProviderEntry>>
export const AUTH_SESSION_PROVIDERS = Symbol('AUTH_SESSION_PROVIDERS')

/** Provider failures must never be mistaken for invalid credentials. */
export class AuthProviderError extends Error {
  constructor(readonly kind: 'unavailable' | 'protocol') {
    super(`authentication provider ${kind}`)
  }
}
