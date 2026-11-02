/** What a member can report something for, in the order the form lists them (the API's REPORT_REASONS, less appeals). */
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Harassment or bullying'],
  ['hate', 'Hate speech'],
  ['scam', 'Scam or fraud'],
  ['illegal', 'Illegal content'],
  ['other', 'Something else'],
] as const
