import 'server-only'
import { kratosAuth } from './providers/kratos/provider'
import type { FrontendAuthProvider } from './types'

// Frontend selection is deliberately single-provider until flow binding and
// identity mapping are implemented. Keep this aligned with the API registry.
const provider: FrontendAuthProvider = kratosAuth

export const AuthForm = provider.Form
export const startAuthUrl = provider.startUrl
export const getLogoutUrl = provider.getLogoutUrl
export const isLogoutUrl = provider.isLogoutUrl
export const getFlowError = provider.getFlowError
export const getApiAuthHeaders = provider.getApiAuthHeaders
export const hasSessionCredentials = provider.hasSessionCredentials
