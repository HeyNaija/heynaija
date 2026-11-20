type Span = { top: number; bottom: number }

/**
 * The part of the window a popover may use: what the window shows, less `edge` at each
 * side, less any bar fixed or sticky to it (the phone's top bar and bottom tabs, as
 * their rectangles say now). A bar in the top half covers from the top down to its
 * bottom edge; one in the bottom half, from its top edge down. A bar with no height is
 * not on screen.
 */
export function freeSpan(view: Span, bars: Span[], edge: number): Span {
  const middle = (view.top + view.bottom) / 2
  let top = view.top + edge
  let bottom = view.bottom - edge
  for (const bar of bars) {
    if (bar.bottom <= bar.top) continue
    if ((bar.top + bar.bottom) / 2 < middle) top = Math.max(top, bar.bottom + edge)
    else bottom = Math.min(bottom, bar.top - edge)
  }
  return { top, bottom }
}

/**
 * Below its anchor if the list fits there (or there is more room below than above),
 * otherwise above, and how tall it may be on that side.
 */
export function placeList({ anchor, span, gap, tallest, content }: { anchor: Span; span: Span; gap: number; tallest: number; content: number }): { down: boolean; maxHeight: number } {
  const below = span.bottom - anchor.bottom - gap
  const above = anchor.top - span.top - gap
  const down = below >= Math.min(tallest, content + 2) || below >= above
  return { down, maxHeight: Math.max(0, Math.min(tallest, down ? below : above)) }
}
