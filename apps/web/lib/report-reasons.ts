/** What a member can report something for, in the order the form lists them (the API's REPORT_REASONS, less appeals). */
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate speech'],
  ['scam', 'Scam or fraud'],
  ['child_safety', 'Child sexual abuse or exploitation'],
  ['illegal', 'Illegal content'],
  ['other', 'Something else'],
] as const

/**
 * Only for a post, while marking posts sensitive is switched on (the adultLabels
 * flag): listed before "Something else".
 */
export const NEEDS_LABEL_REASON = ['needs_label', 'Sensitive, but not marked sensitive'] as const

/**
 * Report a safety concern (Settings), about no one post or account: child safety
 * first. The apps list the same. Bugs and ideas go to the ideas board instead.
 */
export const CONCERN_REASONS = [
  ['child_safety', 'Child sexual abuse or exploitation'],
  ['harassment', 'Harassment, threats or bullying'],
  ['hate', 'Hate speech'],
  ['scam', 'Scam or fraud'],
  ['spam', 'Spam'],
  ['illegal', 'Other illegal content'],
  ['other', 'Something else'],
] as const
