import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freeSpan, placeList, upperEdge } from '../lib/placement.ts'

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

test('a list goes up from above the box it writes into while that leaves room, on either side', () => {
  const span = { top: 72, bottom: 596 }
  // The box's top in view, room above it.
  assert.equal(upperEdge({ anchor: { top: 500, bottom: 540 }, clear: 300, span, gap: 4, least: 168 }), 300)
  // The box's top scrolled out of view, but room below the toolbar: the list goes down, clear of the box.
  const edge = upperEdge({ anchor: { top: 200, bottom: 240 }, clear: -300, span, gap: 4, least: 168 })
  assert.equal(edge, -300)
  assert.deepEqual(placeList({ anchor: { top: edge, bottom: 240 }, span, gap: 4, tallest: 360, content: 500 }), { down: true, maxHeight: 352 })
})

test('a box taller than the screen, its top scrolled away and its toolbar at the bottom: the list goes up from the toolbar, full height', () => {
  const span = { top: 72, bottom: 596 }
  const anchor = { top: 560, bottom: 583 }
  const edge = upperEdge({ anchor, clear: -200, span, gap: 4, least: 168 })
  assert.equal(edge, 560)
  assert.deepEqual(placeList({ anchor: { top: edge, bottom: anchor.bottom }, span, gap: 4, tallest: 360, content: 500 }), { down: false, maxHeight: 360 })
})

test('with nothing to keep clear the list goes up from its anchor', () => {
  assert.equal(upperEdge({ anchor: { top: 400, bottom: 440 }, span: { top: 72, bottom: 596 }, gap: 4, least: 168 }), 400)
})
