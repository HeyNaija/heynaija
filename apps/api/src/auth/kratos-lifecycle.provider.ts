import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { AuthLifecycleProvider, RegistrationCallback, SettingsCallback } from './auth-lifecycle.provider.js'

const registration = z.object({
  identity_id: z.guid(),
  invite_code: z.string().max(100),
  handle: z.string().max(100),
  adult_declared: z.boolean().default(false),
})
const settings = z.object({
  identity_id: z.guid(),
  handle: z.string().max(100),
  previous_handle: z.string().max(100),
})

@Injectable()
export class KratosLifecycleProvider implements AuthLifecycleProvider {
  async registration(body: unknown): Promise<RegistrationCallback | null> {
    const parsed = registration.safeParse(body)
    return parsed.success
      ? { providerId: 'kratos', subject: parsed.data.identity_id, handle: parsed.data.handle, inviteCode: parsed.data.invite_code, adultDeclared: parsed.data.adult_declared }
      : null
  }

  async settings(body: unknown): Promise<SettingsCallback | null> {
    const parsed = settings.safeParse(body)
    return parsed.success
      ? { providerId: 'kratos', subject: parsed.data.identity_id, handle: parsed.data.handle, previousHandle: parsed.data.previous_handle }
      : null
  }
}
