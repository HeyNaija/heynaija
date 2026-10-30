// Times are told in the reader's own time zone, on a 12-hour clock. The server
// does not know that zone, so it tells them in Lagos time, where most readers
// are, and the browser retells them (`LocalTime`).
export const HOME_ZONE = 'Africa/Lagos'

/** How a moment is shown: how long ago, when a post was posted, or its day or month. */
export type TimeFormat = 'ago' | 'posted' | 'date' | 'dayMonth' | 'month'

const OPTIONS = {
  clock: { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' },
  shortDay: { day: 'numeric', month: 'short' },
  shortDate: { day: 'numeric', month: 'short', year: 'numeric' },
  date: { day: 'numeric', month: 'long', year: 'numeric' },
  dayMonth: { day: 'numeric', month: 'long' },
  month: { month: 'long', year: 'numeric' },
  year: { year: 'numeric' },
  exact: {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZoneName: 'short',
  },
} satisfies Record<string, Intl.DateTimeFormatOptions>

const formats = new Map<string, Intl.DateTimeFormat>()

function format(name: keyof typeof OPTIONS, zone: string, at: Date): string {
  const key = `${name} ${zone}`
  let formatter = formats.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-NG', { ...OPTIONS[name], timeZone: zone })
    formats.set(key, formatter)
  }
  return formatter.format(at)
}

/** "now", "5m", "3h", "2d", then the day: "26 Oct", with the year once it is not this year's. */
export function timeAgo(iso: string, now: number, zone = HOME_ZONE): string {
  const at = new Date(iso)
  const seconds = Math.max(0, Math.round((now - at.getTime()) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`
  const thisYear = format('year', zone, at) === format('year', zone, new Date(now))
  return format(thisYear ? 'shortDay' : 'shortDate', zone, at)
}

/** The post in focus says when it was posted in full: "11:52 am · 26 Oct 2026". */
export function postedAt(iso: string, zone = HOME_ZONE): string {
  const at = new Date(iso)
  return `${format('clock', zone, at)} · ${format('shortDate', zone, at)}`
}

/** The exact moment, for a tooltip: "Monday, 26 October 2026 at 11:52 am WAT". */
export function exactTime(iso: string, zone = HOME_ZONE): string {
  return format('exact', zone, new Date(iso))
}

export function formatTime(iso: string, as: TimeFormat, now: number, zone = HOME_ZONE): string {
  if (as === 'ago') return timeAgo(iso, now, zone)
  if (as === 'posted') return postedAt(iso, zone)
  return format(as, zone, new Date(iso))
}
