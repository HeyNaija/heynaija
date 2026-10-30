// The API's limits on a poll (apps/api/src/posts/posts.service.ts), so the
// composer can hold to them as the member types.
export const POLL_OPTIONS_MAX = 10

/** A choice may be 80 characters as the reader sees them; the field allows the code units those can take. */
export const POLL_OPTION_INPUT_MAX = 80 * 16
