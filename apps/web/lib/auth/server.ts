import 'server-only'
import { kratosAuth } from './providers/kratos/provider'
import type { FrontendAuthProvider } from './types'

// Pages and the API client use these, never the provider directly
// (docs/adr/0012). Kratos is the only provider.
const provider: FrontendAuthProvider = kratosAuth

export const AuthForm = provider.Form
export const startAuthUrl = provider.startUrl
export const getLogoutUrl = provider.getLogoutUrl
export const isLogoutUrl = provider.isLogoutUrl
export const getFlowError = provider.getFlowError
export const getApiAuthHeaders = provider.getApiAuthHeaders
export const hasSessionCredentials = provider.hasSessionCredentials
