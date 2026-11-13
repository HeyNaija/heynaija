/** Carries a checked invite code from /join to the signup form; Kratos passes it to our API. */
export const INVITE_COOKIE = 'hn_invite'

/**
 * Set on /join to the age the person stated: AGE_COOKIE_VALUE when they tick "I
 * am 18 or older", or, while the API asks for one (BIRTH_DATE_ENABLED), the date
 * of birth they typed, as YYYY-MM-DD. Kratos passes it to our API's registration
 * webhook (infra/kratos/invite-check.jsonnet), which refuses a signup without it.
 * It carries nothing else, and is cleared when the newcomer finishes or skips the
 * welcome flow (it lasts an hour at most).
 */
export const AGE_COOKIE = 'hn_age'
export const AGE_COOKIE_VALUE = '18-plus'

/**
 * Set for a day when /join refuses someone too young, so changing the year and
 * sending again does not work straight away. Says only that: no date, no age.
 */
export const AGE_REFUSED_COOKIE = 'hn_age_refused'
