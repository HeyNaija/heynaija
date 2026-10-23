import type { ReactNode } from 'react'

export type AuthKind = 'login' | 'registration' | 'verification' | 'settings'
export type AuthFormProps = { kind: AuthKind; flowId: string | string[] | undefined }

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
}
