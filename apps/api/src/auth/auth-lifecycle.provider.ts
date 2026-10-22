/** Provider-neutral payloads emitted by signup/settings callbacks. */
export type RegistrationCallback = {
  providerId: string
  subject: string
  handle: string
  inviteCode: string
  adultDeclared: boolean
}

export type SettingsCallback = {
  providerId: string
  subject: string
  handle: string
  previousHandle: string
}

export interface AuthLifecycleProvider {
  registration(body: unknown): Promise<RegistrationCallback | null>
  settings(body: unknown): Promise<SettingsCallback | null>
}
