import type { AuthFlowRequest, AuthRedirect } from './auth-flow.provider.js'
import type { AuthRequest } from './auth-session.provider.js'

/** Private account reads and provider-owned account-change interactions. */
export interface AuthAccountProvider {
  readonly capabilities: {
    emailRead: boolean
    accountChanges: boolean
  }
  /** Read the selected session's email directly from the provider, without caching. */
  emailForRequest(request: AuthRequest): Promise<string | null>
  /** Email, handle and connected login methods; completion uses the flow contract. */
  beginAccountChange(request: AuthFlowRequest): Promise<AuthRedirect>
}
