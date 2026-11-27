'use client'

import { type PointerEvent, useRef } from 'react'

/**
 * How a button was pressed, read in its click: the pointerType of the press before it
 * ('mouse', 'touch', 'pen'), or null for the keyboard or a screen reader, whose clicks
 * have no press before them. `event.detail` cannot tell these apart: a tap and a mouse
 * click both say 1.
 */
export function usePressedBy() {
  const by = useRef<string | null>(null)
  return {
    onPointerDown: (e: PointerEvent) => {
      by.current = e.pointerType
    },
    onKeyDown: () => {
      by.current = null
    },
    take: () => {
      const pointer = by.current
      by.current = null
      return pointer
    },
  }
}
