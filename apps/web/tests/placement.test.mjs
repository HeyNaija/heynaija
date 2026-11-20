import assert from 'node:assert/strict'
import { test } from 'node:test'
import { freeSpan, placeList } from '../lib/placement.ts'

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
