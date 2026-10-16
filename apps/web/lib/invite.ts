/** Carries a checked invite code from /join to the signup form; Kratos passes it to our API. */
export const INVITE_COOKIE = 'hn_invite'

/**
 * Set on /join when someone confirms they are 18 or older. Kratos passes it to
 * our API's registration webhook (infra/kratos/invite-check.jsonnet), which
 * refuses a signup without it. The value is fixed; it carries nothing else.
 */
export const AGE_COOKIE = 'hn_age'
export const AGE_COOKIE_VALUE = '18-plus'
