/** What a member can report something for, in the order the form lists them (the API's REPORT_REASONS, less appeals). */
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate speech'],
  ['scam', 'Scam or fraud'],
  ['illegal', 'Illegal content'],
  ['other', 'Something else'],
] as const

/**
 * Only for a post, while marking posts sensitive is switched on (the adultLabels
 * flag): listed before "Something else".
 */
export const NEEDS_LABEL_REASON = ['needs_label', 'Sensitive, but not marked sensitive'] as const
