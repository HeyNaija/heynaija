'use client'

import { type RefObject, useLayoutEffect } from 'react'

const GAP = 4
const EDGE = 8

/**
 * Places a `position: fixed` list next to `anchor` while `open`: below it if it
 * fits in what the window shows (the on-screen keyboard taken off), otherwise
 * on whichever side has more room. Fixed to the window, so a scrolling bar
 * around the anchor, like the phone reply bar, cannot clip it. Follows the
 * anchor as the page scrolls, the window or keyboard changes, or either grows.
 */
export function useFixedPlacement(anchor: RefObject<HTMLElement | null>, list: RefObject<HTMLElement | null>, open: boolean, tallest = 320, widest = 320) {
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = list.current
      const box = anchor.current?.getBoundingClientRect()
      if (!el || !box) return
      const view = window.visualViewport
      const top = (view?.offsetTop ?? 0) + EDGE
      const bottom = (view?.offsetTop ?? 0) + (view?.height ?? window.innerHeight) - EDGE
      const below = bottom - box.bottom - GAP
      const above = box.top - top - GAP
      const down = below >= Math.min(tallest, el.scrollHeight + 2) || below >= above
      el.style.left = `${box.left}px`
      el.style.width = `${Math.min(widest, box.width)}px`
      el.style.maxHeight = `${Math.max(0, Math.min(tallest, down ? below : above))}px`
      el.style.top = down ? `${box.bottom + GAP}px` : 'auto'
      el.style.bottom = down ? 'auto' : `${document.documentElement.clientHeight - box.top + GAP}px`
    }
    place()
    const onScroll = (e: Event) => {
      if (e.target !== list.current) place()
    }
    const resized = new ResizeObserver(place)
    for (const el of [anchor.current, list.current]) if (el) resized.observe(el)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      resized.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [anchor, list, open, tallest, widest])
}
