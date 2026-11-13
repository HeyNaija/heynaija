// Community announcements (docs/adr/0029): a moderator may notify every member
// of a community about a new post in it, once a day per community.

/**
 * How long until a community may notify its members again, in words: "in about
 * 5 hours", "in less than an hour". Null when it may now (`nextAt` is null, in
 * the past or not a date). Said as a wait rather than a clock time, so it reads
 * the same whatever time zone the page was rendered in.
 */
export function announcementWait(nextAt: string | null | undefined, now: number): string | null {
  if (!nextAt) return null
  const ms = new Date(nextAt).getTime() - now
  if (!(ms > 0)) return null
  const hours = Math.round(ms / 3_600_000)
  if (hours < 1) return 'in less than an hour'
  return hours === 1 ? 'in about an hour' : `in about ${hours} hours`
}
