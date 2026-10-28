import { useSyncExternalStore } from 'react'

/**
 * What the reader did to posts in this tab: liked or unliked, reposted or not,
 * and the reply counts their own replies changed. Every copy of a post on screen
 * shows it, and so do pages the browser brings back from its cache on Back,
 * which were drawn before. Kept in memory only, so a reload starts afresh from
 * what the server says.
 */
type Mine = {
  liked?: boolean
  reposted?: boolean
  /** A vote for an idea on the board. */
  voted?: boolean
  /** The reply count after the reader's own reply, and the count it was drawn with before. */
  replies?: { count: number; base: number }
}

const mine = new Map<string, Mine>()
const listeners = new Set<() => void>()

export function remember(id: string, change: Mine) {
  mine.set(id, { ...mine.get(id), ...change })
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useMine(id: string): Mine | undefined {
  return useSyncExternalStore(subscribe, () => mine.get(id), () => undefined)
}

/**
 * A count the server drew with `drawnOn` as the reader's own state, shown with
 * their latest choice `chosen` instead: one more or one fewer when they differ.
 */
export const withChoice = (count: number, drawnOn: boolean, chosen: boolean) =>
  Math.max(0, count + (chosen === drawnOn ? 0 : chosen ? 1 : -1))
