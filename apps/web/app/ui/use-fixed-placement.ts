'use client'

import { type RefObject, useLayoutEffect } from 'react'
import { boxCap, freeSpan, placeList, roomBeside } from '@/lib/placement'

const GAP = 4
const EDGE = 8
// The phone's top bar and bottom tabs paint over a list placed under them, so a list keeps clear of them.
const BARS = '.square-topbar, .square-bottom-nav'
// A search box and three rows of emoji: a list placed beside the box gets at least this much.
const USABLE = 36 + 3 * 44
// A search box, one row and the panel's padding: less than this beside the box and toolbar, and the list covers the toolbar instead.
const FEWEST = 36 + 44 + 24

type Span = { top: number; bottom: number }

/** Where a composer's picker goes: under or over `anchor` (the toolbar), never over `clear` (the writing row), following `frame` (the form) as it grows; `box` gives up height when there is no room. */
export type PickerPlace = {
  anchor: RefObject<HTMLElement | null>
  clear: RefObject<HTMLElement | null>
  frame: RefObject<HTMLElement | null>
  box: RefObject<HTMLTextAreaElement | null>
}

/** The emoji picker's placement: held to the side it opened on while only its content changes. */
export function usePickerPlacement(place: PickerPlace, panel: RefObject<HTMLElement | null>, size: { tallest: number; widest: number }) {
  useFixedPlacement(place.anchor, panel, true, { ...size, clear: place.clear, frame: place.frame, box: place.box, keepSide: true })
}

/** The height of one line of `box`, with its padding and border, or its min-height if that is more. */
function oneLine(box: HTMLTextAreaElement) {
  const style = getComputedStyle(box)
  const px = (value: string) => parseFloat(value) || 0
  const line = px(style.lineHeight) || px(style.fontSize) * 1.2
  return Math.max(px(style.minHeight), line + px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth))
}

/** Scrolls `box` so the row with its caret is in view, measured on a copy laid out with the text before the caret. */
function showCaret(box: HTMLTextAreaElement) {
  const copy = box.cloneNode() as HTMLTextAreaElement
  copy.style.cssText = `position:absolute;visibility:hidden;height:0;min-height:0;max-height:none;width:${box.offsetWidth}px`
  copy.value = box.value.slice(0, box.selectionEnd)
  box.parentNode?.appendChild(copy)
  const end = copy.scrollHeight
  copy.remove()
  const line = parseFloat(getComputedStyle(box).lineHeight) || 20
  if (end > box.scrollTop + box.clientHeight) box.scrollTop = end - box.clientHeight
  else if (end - line < box.scrollTop) box.scrollTop = Math.max(0, end - line - parseFloat(getComputedStyle(box).paddingTop))
}

/**
 * Places a `position: fixed` list next to `anchor` while `open`: below it if it
 * fits in what the window shows (the on-screen keyboard taken off), otherwise
 * on whichever side has more room, clear of the phone's top bar and bottom tabs. Fixed to the window, so a scrolling bar
 * around the anchor, like the phone reply bar, cannot clip it. Follows the
 * anchor as the page scrolls, the window or keyboard changes, or it, the list, `clear` or `frame` changes size.
 *
 * `clear` is what sits above the anchor and must stay in view, like the box a picker
 * writes into: the list goes above it or below the anchor, never over either. Where
 * neither side leaves the list `USABLE` room, `box` (the textarea in `clear`) is capped
 * and scrolled to its caret until there is, or down to one line for a shorter list; where
 * even that leaves too little, the list may cover the anchor but still not the box. With `keepSide` the list stays on
 * the side it opened on while that leaves it room and only sizes change (its own content,
 * the composer growing); a scroll or a change in the window or keyboard chooses again.
 */
export function useFixedPlacement(
  anchor: RefObject<HTMLElement | null>,
  list: RefObject<HTMLElement | null>,
  open: boolean,
  { tallest = 320, widest = 320, clear, frame, box, keepSide = false }: { tallest?: number; widest?: number; clear?: RefObject<HTMLElement | null>; frame?: RefObject<HTMLElement | null>; box?: RefObject<HTMLTextAreaElement | null>; keepSide?: boolean } = {},
) {
  useLayoutEffect(() => {
    if (!open) return
    let side: 'up' | 'down' | undefined
    let capped: number | null = null
    const textarea = box?.current ?? null
    const measure = () => {
      const view = window.visualViewport
      const offset = view?.offsetTop ?? 0
      const bars = [...document.querySelectorAll(BARS)].map((bar) => bar.getBoundingClientRect())
      const span = freeSpan({ top: offset, bottom: offset + (view?.height ?? window.innerHeight) }, bars, EDGE)
      const at = anchor.current!.getBoundingClientRect()
      const row = clear?.current?.getBoundingClientRect()
      const whole: Span = row ? { top: Math.min(at.top, row.top), bottom: Math.max(at.bottom, row.bottom) } : at
      return { span, at, whole, row: row ?? at }
    }
    // Caps the box so the list has room beside the box and toolbar: USABLE if it can, at least FEWEST with the box at one
    // line, or failing that room beside the box alone. Says which to keep clear.
    const fitBox = (): 'whole' | 'row' => {
      if (!textarea) return 'whole'
      const scrolled = textarea.scrollTop
      textarea.style.maxHeight = ''
      const full = measure()
      let keep: 'whole' | 'row' = 'whole'
      let cap: number | null = null
      if (roomBeside(full.whole, full.span, GAP) < USABLE) {
        const height = textarea.offsetHeight
        const smallest = oneLine(textarea)
        textarea.style.maxHeight = `${smallest}px`
        const least = measure()
        const fits = (part: 'whole' | 'row') => boxCap({ least: USABLE, height, smallest, room: roomBeside(full[part], full.span, GAP), roomAtSmallest: roomBeside(least[part], least.span, GAP) })
        const whole = fits('whole')
        if (whole !== undefined) cap = whole
        else if (roomBeside(least.whole, least.span, GAP) >= FEWEST) cap = smallest
        else {
          keep = 'row'
          const row = fits('row')
          cap = row === undefined ? smallest : row
        }
      }
      textarea.style.maxHeight = cap === null ? '' : `${cap}px`
      if (cap !== null && cap !== capped) showCaret(textarea)
      else textarea.scrollTop = scrolled
      capped = cap
      return keep
    }
    const place = (choose: boolean) => {
      const el = list.current
      if (!el || !anchor.current) return
      const keep = fitBox()
      const { span, at, whole, row } = measure()
      const part = keep === 'whole' ? whole : row
      const { down, maxHeight } = placeList({ anchor: part, span, gap: GAP, tallest, content: el.scrollHeight, side: keepSide && !choose ? side : undefined, least: USABLE })
      side = down ? 'down' : 'up'
      el.style.left = `${at.left}px`
      el.style.width = `${Math.min(widest, at.width)}px`
      el.style.maxHeight = `${maxHeight}px`
      el.style.top = down ? `${part.bottom + GAP}px` : 'auto'
      el.style.bottom = down ? 'auto' : `${document.documentElement.clientHeight - part.top + GAP}px`
    }
    const choose = () => place(true)
    choose()
    const onScroll = (e: Event) => {
      if (!list.current?.contains(e.target as Node) && e.target !== textarea) choose()
    }
    const resized = new ResizeObserver(() => place(false))
    for (const el of [anchor.current, list.current, clear?.current, frame?.current]) if (el) resized.observe(el)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', choose)
    window.visualViewport?.addEventListener('resize', choose)
    window.visualViewport?.addEventListener('scroll', choose)
    return () => {
      resized.disconnect()
      if (textarea) textarea.style.maxHeight = ''
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', choose)
      window.visualViewport?.removeEventListener('resize', choose)
      window.visualViewport?.removeEventListener('scroll', choose)
    }
  }, [anchor, list, open, tallest, widest, clear, frame, box, keepSide])
}
