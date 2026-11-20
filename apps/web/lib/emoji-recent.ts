export const RECENT_MAX = 16

/** `emoji` first, once, with the list cut to the last RECENT_MAX. */
export function remember(list: readonly string[], emoji: string): string[] {
  return [emoji, ...list.filter((e) => e !== emoji)].slice(0, RECENT_MAX)
}

/** What storage held, or none when it is missing or not a list of strings. */
export function readRecent(stored: string | null): string[] {
  try {
    const list: unknown = JSON.parse(stored ?? '')
    return Array.isArray(list) && list.every((e) => typeof e === 'string') ? list.slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}
