import type { AuthRequest } from './auth-session.provider.js'

export type AuthFlowKind = 'login' | 'registration' | 'verification' | 'settings'
export type AuthFlowRequest = AuthRequest & { origin?: string }
export type AuthFormNode = {
  type: string
  group: string
  attributes: Record<string, unknown>
  messages?: unknown[]
  meta?: Record<string, unknown>
}
export type AuthForm = {
  id: string
  active?: string
  refresh?: boolean
  ui: { action: string; method: string; nodes: AuthFormNode[]; messages?: unknown[] }
}
/** HTTP effects must reach the browser, especially separate Set-Cookie headers. */
export type AuthRedirect = { kind: 'redirect'; location: string; cookies: string[] }
export type AuthInteraction = AuthRedirect | {
  kind: 'form'
  providerKind: 'kratos'
  form: AuthForm
}

export interface AuthFlowProvider {
  begin(kind: AuthFlowKind, request: AuthFlowRequest): Promise<AuthRedirect>
  reauthenticate(request: AuthFlowRequest): Promise<AuthRedirect>
  resume(kind: AuthFlowKind, id: string, request: AuthFlowRequest): Promise<AuthInteraction>
  submit(kind: AuthFlowKind, id: string, form: string, request: AuthFlowRequest): Promise<AuthRedirect>
  logoutUrl(request: AuthFlowRequest): Promise<string | null>
  logout(token: string, request: AuthFlowRequest): Promise<AuthRedirect>
  error(id: string): Promise<string | null>
}
export const AUTH_DEFAULT_PROVIDER = Symbol('AUTH_DEFAULT_PROVIDER')
