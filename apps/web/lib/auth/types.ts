import type { ReactNode } from 'react'

export type AuthKind = 'login' | 'registration' | 'verification' | 'settings'
/**
 * A signup page's own part of the first step: fields shown above the provider's
 * (the invite code), the route that step posts to instead (it hands the step on
 * with submitRegistration), and values to fill the provider's fields with.
 */
export type SignupStart = { fields: ReactNode; action: (flowId: string) => string; values?: Record<string, string | undefined> }

export type AuthFormProps = { kind: AuthKind; flowId: string | string[] | undefined; signup?: SignupStart }

/** What the pages need from the sign-in backend; its form schema stays inside the provider. */
export interface FrontendAuthProvider {
  Form(props: AuthFormProps): Promise<ReactNode>
  startUrl(kind: AuthKind): string
  getLogoutUrl(): Promise<string | null>
  isLogoutUrl(url: string): boolean
  getFlowError(id: string): Promise<string | null>
  getApiAuthHeaders(): Promise<Record<string, string>>
  /** Whether a session cookie is present at all; the API decides whether it is valid. */
  hasSessionCredentials(): Promise<boolean>
  /** Hands the first signup step on, as the browser would have sent it; see SignupStart. */
  submitRegistration(flowId: string, fields: Record<string, string>): Promise<{ location: string | null; cookies: string[] }>
}
