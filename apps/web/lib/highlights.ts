const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/**
 * When the week's highlights go out, in Nigerian time, from the day and hour the
 * API works in (UTC). Nigeria is an hour ahead all year: "Sundays at about 6pm".
 */
export function highlightsTime(weekday: number, hourUtc: number): string {
  const hour = (hourUtc + 1) % 24
  // 23:00 UTC is already midnight of the next day in Lagos.
  const day = DAYS[(weekday + (hourUtc === 23 ? 1 : 0)) % 7]
  const clock = hour === 0 ? 'midnight' : hour === 12 ? 'noon' : hour < 12 ? `${hour}am` : `${hour - 12}pm`
  return `${day}s at about ${clock}`
}

/** A number of days in words: "3 days", "1 day", and whole weeks from two up, "8 weeks" for 56. */
export function daysInWords(days: number): string {
  if (days >= 14 && days % 7 === 0) return `${days / 7} weeks`
  return days === 1 ? '1 day' : `${days} days`
}
