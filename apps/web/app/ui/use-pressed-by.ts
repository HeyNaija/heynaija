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

/**
 * Where focus goes when a picker opens from a button pressed by `pointer`: into the picker for the
 * keyboard or a screen reader, back to the box for a mouse (the caret stays where it was), and
 * nowhere for touch or a pen, as focusing the box would raise the on-screen keyboard over the picker.
 */
export function focusOnOpen(pointer: string | null): 'picker' | 'box' | 'none' {
  if (pointer === null) return 'picker'
  return pointer === 'mouse' ? 'box' : 'none'
}
