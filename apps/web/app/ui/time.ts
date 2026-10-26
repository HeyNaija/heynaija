export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Times are told in Lagos time, saying so where it could be mistaken for the reader's own.
const clock = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const day = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' })
const exact = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
})

/** The post in focus says when it was posted in full: "11:52 · 26 Oct 2026". */
export function postedAt(iso: string): string {
  const date = new Date(iso)
  return `${clock.format(date)} · ${day.format(date)}`
}

/** The exact moment, for a tooltip: "Monday, 26 October 2026 at 11:52 WAT". */
export function exactTime(iso: string): string {
  return exact.format(new Date(iso))
}
