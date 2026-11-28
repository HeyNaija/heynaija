import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boxCap, freeSpan, placeList, roomBeside } from '../lib/placement.ts'

const view = { top: 0, bottom: 667 }

test('with no bars the span is the window less an edge on each side', () => {
  assert.deepEqual(freeSpan(view, [], 8), { top: 8, bottom: 659 })
})

test('a sticky bar at the top and a nav at the bottom are kept out of the span', () => {
  const bars = [{ top: 0, bottom: 64 }, { top: 604, bottom: 667 }]
  assert.deepEqual(freeSpan(view, bars, 8), { top: 72, bottom: 596 })
})

test('a bar that is not on screen (display none, off to the side of the span) changes nothing', () => {
  assert.deepEqual(freeSpan(view, [{ top: 0, bottom: 0 }], 8), { top: 8, bottom: 659 })
})

test('the list goes below when it fits, otherwise on the side with more room, never into a bar', () => {
  const span = freeSpan(view, [{ top: 0, bottom: 64 }], 8)
  assert.deepEqual(placeList({ anchor: { top: 100, bottom: 140 }, span, gap: 4, tallest: 320, content: 400 }), { down: true, maxHeight: 320 })
  // Anchor low on the screen: more room above, but only down to the bar's edge.
  assert.deepEqual(placeList({ anchor: { top: 500, bottom: 540 }, span, gap: 4, tallest: 320, content: 400 }), { down: false, maxHeight: 320 })
  assert.deepEqual(placeList({ anchor: { top: 200, bottom: 240 }, span: { top: 72, bottom: 300 }, gap: 4, tallest: 320, content: 400 }), { down: false, maxHeight: 124 })
})

test('a landscape phone with the reply bar open: the room above ends at the top bar', () => {
  const small = { top: 0, bottom: 375 }
  const span = freeSpan(small, [{ top: 0, bottom: 64 }], 8)
  const placed = placeList({ anchor: { top: 250, bottom: 330 }, span, gap: 4, tallest: 360, content: 500 })
  assert.equal(placed.down, false)
  assert.equal(placed.maxHeight, 250 - 72 - 4)
})

test('a list held to the side it opened on keeps that side as its content shrinks, and only its height follows', () => {
  const span = { top: 72, bottom: 596 }
  const anchor = { top: 392, bottom: 392 }
  // 200px below, 316px above: a full picker opens above.
  assert.deepEqual(placeList({ anchor, span, gap: 4, tallest: 360, content: 500 }), { down: false, maxHeight: 316 })
  // Searching leaves one row: free to choose, it would jump below.
  assert.equal(placeList({ anchor, span, gap: 4, tallest: 360, content: 120 }).down, true)
  assert.deepEqual(placeList({ anchor, span, gap: 4, tallest: 360, content: 120, side: 'up' }), { down: false, maxHeight: 316 })
  assert.deepEqual(placeList({ anchor, span, gap: 4, tallest: 360, content: 500, side: 'down' }), { down: true, maxHeight: 200 })
})

test('a list held to a side that no longer leaves room for it (the composer grew under it) chooses again', () => {
  const span = { top: 72, bottom: 796 }
  // Opened below; a poll opened above the toolbar and pushed it down to 700: 92px are left below.
  const anchor = { top: 300, bottom: 700 }
  assert.deepEqual(placeList({ anchor, span, gap: 4, tallest: 360, content: 500, side: 'down', least: 168 }), { down: false, maxHeight: 224 })
  assert.equal(placeList({ anchor: { top: 300, bottom: 500 }, span, gap: 4, tallest: 360, content: 500, side: 'down', least: 168 }).down, true)
})

test('the room beside a part is the larger side less the gap', () => {
  assert.equal(roomBeside({ top: 100, bottom: 400 }, { top: 72, bottom: 596 }, 4), 192)
  assert.equal(roomBeside({ top: 300, bottom: 400 }, { top: 72, bottom: 596 }, 4), 224)
})

test('a box that leaves a list too little room is capped by what is missing, measured at its smallest', () => {
  // 150px beside the box at 265px, 168 needed; at 40px it would leave 375: it keeps 247.
  assert.equal(boxCap({ least: 168, height: 265, smallest: 40, room: 150, roomAtSmallest: 375 }), 247)
  // The phone reply bar grows upward: the room is gained above, and the same sum holds.
  assert.equal(boxCap({ least: 168, height: 120, smallest: 40, room: 100, roomAtSmallest: 180 }), 52)
})

test('a box with room enough is not capped, and one that cannot make room even at its smallest says so', () => {
  assert.equal(boxCap({ least: 168, height: 265, smallest: 40, room: 168, roomAtSmallest: 393 }), null)
  assert.equal(boxCap({ least: 168, height: 200, smallest: 40, room: 3, roomAtSmallest: 114 }), undefined)
})
