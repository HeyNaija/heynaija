import type { ReactNode } from 'react'

export type AuthKind = 'login' | 'registration' | 'verification' | 'settings'
export type AuthFormProps = { kind: AuthKind; flowId: string | string[] | undefined }

/** Server-side page integration; provider form schemas stay inside the adapter. */
export interface FrontendAuthProvider {
  Form(props: AuthFormProps): Promise<ReactNode>
  startUrl(kind: AuthKind): string
  getLogoutUrl(): Promise<string | null>
  isLogoutUrl(url: string): boolean
  getFlowError(id: string): Promise<string | null>
  getApiAuthHeaders(): Promise<Record<string, string>>
  /** Credential presence only; the API remains the authority on authentication. */
  hasSessionCredentials(): Promise<boolean>
}
