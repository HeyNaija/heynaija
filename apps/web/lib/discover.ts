/** Discover's window in words: "3 days" for 72 hours, "36 hours" for 36. */
export function discoverPeriod(hours: number): string {
  if (hours % 24 === 0) return hours === 24 ? 'day' : `${hours / 24} days`
  return hours === 1 ? 'hour' : `${hours} hours`
}
