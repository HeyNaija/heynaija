import type { ReactNode } from 'react'

export type AuthKind = 'login' | 'registration' | 'verification' | 'settings'
/**
 * `googleAction`, on a registration flow: where its Google button posts instead,
 * so that only the handle goes with it (see app/(auth)/signup/google/route.ts).
 */
export type AuthFormProps = { kind: AuthKind; flowId: string | string[] | undefined; googleAction?: (flowId: string) => string }

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
  /** Hands a registration step on to the backend as the browser would have sent it. */
  submitRegistration(flowId: string, fields: Record<string, string>): Promise<{ location: string | null; cookies: string[] }>
}
