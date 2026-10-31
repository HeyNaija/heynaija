import type { Env } from '../env.js'

export type DiditConfig = {
  apiKey: string
  workflowId: string
  webhookSecret: string
  /** Where Didit's hosted page sends the member back to when they finish. */
  callbackUrl: string
}

/** Didit's API (https://docs.didit.me/sessions-api/create-session). */
export const DIDIT_API_URL = 'https://verification.didit.me'

/**
 * The Didit settings, or null unless all three are present. Anything less fails
 * closed: no session is offered or created and no webhook is accepted, and the API
 * still starts. (A missing webhook secret in particular must never mean "accept
 * anything".)
 */
export function diditConfig(env: Pick<Env, 'DIDIT_API_KEY' | 'DIDIT_WORKFLOW_ID' | 'DIDIT_WEBHOOK_SECRET' | 'WEB_PUBLIC_URL'>): DiditConfig | null {
  if (!env.DIDIT_API_KEY || !env.DIDIT_WORKFLOW_ID || !env.DIDIT_WEBHOOK_SECRET) return null
  return {
    apiKey: env.DIDIT_API_KEY,
    workflowId: env.DIDIT_WORKFLOW_ID,
    webhookSecret: env.DIDIT_WEBHOOK_SECRET,
    callbackUrl: `${env.WEB_PUBLIC_URL}/settings/age-verification`,
  }
}
