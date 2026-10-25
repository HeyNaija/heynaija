/** Carries a checked invite code to Kratos, which passes it to our API's registration webhook. */
export const INVITE_COOKIE = 'hn_invite'

/**
 * Set when someone confirms they are 18 or older. Kratos passes it to our API's
 * registration webhook (infra/kratos/invite-check.jsonnet), which refuses a
 * signup without it. The value is fixed; it carries nothing else.
 */
export const AGE_COOKIE = 'hn_age'
export const AGE_COOKIE_VALUE = '18-plus'

/**
 * What someone typed on /signup, kept for a few minutes so the form comes back
 * filled in: after an invite link (/join?code=…), or when the invite code was
 * refused. Never in the URL, since it can hold an email address.
 */
export const SIGNUP_DRAFT_COOKIE = 'hn_signup_draft'

export type SignupDraft = { code?: string; adult?: boolean; email?: string; handle?: string }

/** Why the invite step sent someone back to /signup (its `invite` parameter). */
export type InviteProblem = 'age' | 'invalid' | 'failed'

export function readDraft(value: string | undefined): SignupDraft {
  if (!value) return {}
  try {
    const draft = JSON.parse(value) as Record<string, unknown>
    const text = (key: string) => (typeof draft[key] === 'string' ? (draft[key] as string).slice(0, 100) : undefined)
    return { code: text('code'), adult: draft.adult === true, email: text('email'), handle: text('handle') }
  } catch {
    return {}
  }
}

/** Letters and digits only: the code goes into a cookie that Kratos reads raw. */
export const normaliseCode = (typed: string) => typed.toUpperCase().replace(/[^0-9A-Z]/g, '')
