/** Carries a checked invite code from /join to the signup form; Kratos passes it to our API. */
export const INVITE_COOKIE = 'hn_invite'

/**
 * Set on /join to the date of birth the person typed, as YYYY-MM-DD. Kratos
 * passes it to our API's registration webhook (infra/kratos/invite-check.jsonnet),
 * which refuses a signup without it and keeps the date with the age record. It
 * carries nothing else, and is cleared when the newcomer finishes or skips the
 * welcome flow (it lasts an hour at most).
 */
export const AGE_COOKIE = 'hn_age'

/**
 * Set for a day when /join refuses someone too young, so changing the year and
 * sending again does not work straight away. Says only that: no date, no age.
 */
export const AGE_REFUSED_COOKIE = 'hn_age_refused'
