'use client'

import { useSyncExternalStore } from 'react'
import { exactTime, formatTime, HOME_ZONE, type TimeFormat } from './time'

let zone: string | undefined
const readerZone = () => (zone ??= Intl.DateTimeFormat().resolvedOptions().timeZone || HOME_ZONE)

// One clock for every time on the page. It wakes them often enough that "now"
// turns into "1m" on time, and at once when the tab is looked at again; only
// those whose words changed draw again.
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
const tick = () => listeners.forEach((listener) => listener())

function onTick(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(tick, 15_000)
    document.addEventListener('visibilitychange', tick)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size || !timer) return
    clearInterval(timer)
    timer = undefined
    document.removeEventListener('visibilitychange', tick)
  }
}

const unchanging = () => () => {}

/**
 * A moment, told in the reader's own time zone and kept current. The server
 * tells it as of `now`, the moment it rendered the page, in Lagos time; the
 * browser then retells it as of its own clock, so a page kept open, or shown
 * again from the router's cache, does not go stale. `title` adds the exact
 * moment as a tooltip.
 */
export function LocalTime({
  at,
  as = 'ago',
  now = 0,
  title = false,
  className,
}: { at: string; title?: boolean; className?: string } & ({ as?: 'ago'; now: number } | { as: Exclude<TimeFormat, 'ago'>; now?: never })) {
  const text = useSyncExternalStore(
    as === 'ago' ? onTick : unchanging,
    () => formatTime(at, as, Date.now(), readerZone()),
    () => formatTime(at, as, now, HOME_ZONE),
  )
  const tip = useSyncExternalStore(
    unchanging,
    () => (title ? exactTime(at, readerZone()) : undefined),
    () => (title ? exactTime(at, HOME_ZONE) : undefined),
  )
  return (
    <time dateTime={at} title={tip} className={className}>
      {text}
    </time>
  )
}
