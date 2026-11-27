'use client'

import { type RefObject, useLayoutEffect } from 'react'
import { freeSpan, placeList, upperEdge } from '@/lib/placement'

const GAP = 4
const EDGE = 8
// The phone's top bar and bottom tabs paint over a list placed under them, so a list keeps clear of them.
const BARS = '.square-topbar, .square-bottom-nav'
// A search box and three rows of emoji: with less room than that on both sides of `clear`, the list goes over it.
const USABLE = 36 + 3 * 44

/**
 * Places a `position: fixed` list next to `anchor` while `open`: below it if it
 * fits in what the window shows (the on-screen keyboard taken off), otherwise
 * on whichever side has more room, clear of the phone's top bar and bottom tabs. Fixed to the window, so a scrolling bar
 * around the anchor, like the phone reply bar, cannot clip it. Follows the
 * anchor as the page scrolls, the window or keyboard changes, or either grows.
 *
 * `clear` is what sits above the anchor and must stay in view, like the box a picker
 * writes into: a list that goes up goes above it rather than over it, unless the box is
 * taller than the screen and leaves too little room on either side. With `keepSide`
 * the list stays on the side it opened on while its own content grows or shrinks (a
 * search narrowing its results), and only its height follows; a scroll or a change in
 * the window or keyboard chooses again.
 */
export function useFixedPlacement(
  anchor: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  open: boolean,
  { tallest = 320, widest = 320, clear, keepSide = false }: { tallest?: number; widest?: number; clear?: RefObject<HTMLElement | null>; keepSide?: boolean } = {},
) {
  useLayoutEffect(() => {
    if (!open) return
    let side: 'up' | 'down' | undefined
    const place = (choose: boolean) => {
      const el = list.current
      const box = anchor.current?.getBoundingClientRect()
      if (!el || !box) return
      const view = window.visualViewport
      const offset = view?.offsetTop ?? 0
      const bars = [...document.querySelectorAll(BARS)].map((bar) => bar.getBoundingClientRect())
      const span = freeSpan({ top: offset, bottom: offset + (view?.height ?? window.innerHeight) }, bars, EDGE)
      const top = upperEdge({ anchor: box, clear: clear?.current?.getBoundingClientRect().top, span, gap: GAP, least: USABLE })
      const { down, maxHeight } = placeList({ anchor: { top, bottom: box.bottom }, span, gap: GAP, tallest, content: el.scrollHeight, side: keepSide && !choose ? side : undefined })
      side = down ? 'down' : 'up'
      el.style.left = `${box.left}px`
      el.style.width = `${Math.min(widest, box.width)}px`
      el.style.maxHeight = `${maxHeight}px`
      el.style.top = down ? `${box.bottom + GAP}px` : 'auto'
      el.style.bottom = down ? 'auto' : `${document.documentElement.clientHeight - top + GAP}px`
    }
    const choose = () => place(true)
    choose()
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) choose()
    }
    const resized = new ResizeObserver(() => place(false))
    for (const el of [anchor.current, list.current, clear?.current]) if (el) resized.observe(el)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', choose)
    window.visualViewport?.addEventListener('resize', choose)
    window.visualViewport?.addEventListener('scroll', choose)
    return () => {
      resized.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', choose)
      window.visualViewport?.removeEventListener('resize', choose)
      window.visualViewport?.removeEventListener('scroll', choose)
    }
  }, [anchor, list, open, tallest, widest, clear, keepSide])
}
