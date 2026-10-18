'use client'

import { type RefObject, useLayoutEffect } from 'react'

/**
 * Grows a textarea to fit what is typed in it, up to its CSS `max-height`, past
 * which it scrolls. Re-fits when the text changes, when its `rows` change (the
 * composer opens to a few rows when focused) and when the box changes width (a
 * rotated phone wraps lines differently). Without script it stays at its `rows`.
 */
export function useAutoGrow(box: RefObject<HTMLTextAreaElement | null>, value: string, rows: number) {
  useLayoutEffect(() => {
    const textarea = box.current
    if (!textarea) return
    const fit = () => {
      // Let it shrink first, or it could never get smaller. scrollHeight leaves out
      // the border, which the box (border-box) has to include.
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`
    }
    fit()
    let width = textarea.offsetWidth
    const watch = new ResizeObserver(() => {
      if (textarea.offsetWidth === width) return
      width = textarea.offsetWidth
      fit()
    })
    watch.observe(textarea)
    return () => watch.disconnect()
  }, [box, value, rows])
}
