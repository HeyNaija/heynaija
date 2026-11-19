import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moveInGrid } from '../lib/emoji-grid.ts'

// Two sections of 10 and 6 cells, four to a row: 0-3 / 4-7 / 8-9, then 10-13 / 14-15.
const sections = [10, 6]
const move = (key, at, options = {}) => moveInGrid({ key, at, sections, columns: 4, ...options })

test('left and right step through the cells, across a section boundary, and stop at the ends', () => {
  assert.equal(move('ArrowRight', 3), 4)
  assert.equal(move('ArrowRight', 9), 10)
  assert.equal(move('ArrowLeft', 10), 9)
  assert.equal(move('ArrowLeft', 0), 0)
  assert.equal(move('ArrowRight', 15), 15)
})

test('down and up keep the column, one row at a time', () => {
  assert.equal(move('ArrowDown', 1), 5)
  assert.equal(move('ArrowUp', 5), 1)
})

test('down from a row whose column is missing below goes to the last cell of the section', () => {
  assert.equal(move('ArrowDown', 7), 9)
})

test('down from the last row goes to the next section, in the same column or its last cell', () => {
  assert.equal(move('ArrowDown', 8), 10)
  assert.equal(move('ArrowDown', 9), 11)
  assert.equal(move('ArrowDown', 15), 15)
})

test('up from the first row goes to the last row of the section above, clamped to its length', () => {
  assert.equal(move('ArrowUp', 10), 8)
  assert.equal(move('ArrowUp', 13), 9)
  assert.equal(move('ArrowUp', 2), 2)
})

test('rows of unequal length: the last row of the lower section is shorter', () => {
  assert.equal(move('ArrowDown', 11), 15)
  assert.equal(move('ArrowDown', 13), 15)
})

test('home and end go to the start and end of the row; with control, of the whole grid', () => {
  assert.equal(move('Home', 6), 4)
  assert.equal(move('End', 6), 7)
  assert.equal(move('End', 8), 9)
  assert.equal(move('End', 15), 15)
  assert.equal(move('Home', 6, { ctrl: true }), 0)
  assert.equal(move('End', 6, { ctrl: true }), 15)
})

test('nothing to move in, or a key that is not for the grid, gives null', () => {
  assert.equal(moveInGrid({ key: 'ArrowDown', at: 0, sections: [], columns: 4 }), null)
  assert.equal(moveInGrid({ key: 'ArrowDown', at: 0, sections: [0], columns: 4 }), null)
  assert.equal(move('a', 3), null)
  assert.equal(move('Tab', 3), null)
})

test('an empty section is skipped', () => {
  assert.equal(moveInGrid({ key: 'ArrowDown', at: 1, sections: [2, 0, 3], columns: 4 }), 3)
  assert.equal(moveInGrid({ key: 'ArrowUp', at: 3, sections: [2, 0, 3], columns: 4 }), 1)
})

test('down into a section shorter than the column lands on its last cell', () => {
  assert.equal(moveInGrid({ key: 'ArrowDown', at: 3, sections: [4, 2], columns: 4 }), 5)
})
