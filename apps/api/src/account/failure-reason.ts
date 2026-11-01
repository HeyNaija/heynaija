import { DrizzleQueryError } from 'drizzle-orm'
import { AuthProviderError } from '../auth/auth-session.provider.js'
import { AccountDeletionError } from './account-deletion.service.js'

const codeOf = (err: unknown): string | undefined => {
  const code = (err as { code?: unknown } | undefined)?.code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined
}

/**
 * Why something about a deletion failed, fit for a log line and for the failed
 * job BullMQ keeps in Redis. An error's own message can hold what it was given:
 * Drizzle's has the query's parameters, a handle among them, and a mail
 * server's can name the address it refused. So only the messages written here
 * are kept; for any other error, its kind and code.
 */
export function failureReason(err: unknown): string {
  if (err instanceof AccountDeletionError || err instanceof AuthProviderError) return err.message
  if (err instanceof DrizzleQueryError) return `database error ${codeOf(err.cause) ?? 'with no code'}`
  if (err instanceof Error) return [err.name, codeOf(err)].filter(Boolean).join(' ')
  return 'unknown error'
}
