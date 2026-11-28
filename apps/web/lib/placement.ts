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

/** The room beside `part` within `span`: the larger of what is above it and below it, less `gap`. */
export function roomBeside(part: Span, span: Span, gap: number): number {
  return Math.max(part.top - span.top, span.bottom - part.bottom) - gap
}

/**
 * The height the box a list writes into may keep while the list is open beside `part` (the
 * box and its toolbar, or the box alone), or null when it needs no cap: `room` is the room
 * beside the part with the box at `height`, `roomAtSmallest` with the box at `smallest`.
 * Undefined when even the smallest box leaves the list less than `least`.
 */
export function boxCap({ least, height, smallest, room, roomAtSmallest }: { least: number; height: number; smallest: number; room: number; roomAtSmallest: number }): number | null | undefined {
  if (room >= least) return null
  if (roomAtSmallest < least) return undefined
  return Math.min(height, smallest + roomAtSmallest - least)
}

/**
 * Below its anchor if the list fits there (or there is more room below than above),
 * otherwise above, and how tall it may be on that side. Given a `side`, the list
 * stays there and only its height follows, while that side leaves it `least`.
 */
export function placeList({ anchor, span, gap, tallest, content, side, least = 0 }: { anchor: Span; span: Span; gap: number; tallest: number; content: number; side?: 'up' | 'down'; least?: number }): { down: boolean; maxHeight: number } {
  const below = span.bottom - anchor.bottom - gap
  const above = anchor.top - span.top - gap
  const kept = side && (side === 'down' ? below : above) >= least ? side : undefined
  const down = kept ? kept === 'down' : below >= Math.min(tallest, content + 2) || below >= above
  return { down, maxHeight: Math.max(0, Math.min(tallest, down ? below : above)) }
}
