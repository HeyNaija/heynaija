import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmCopy, confirmStep, continuesPress, pressedWith, restOfHeldPress, wrapFocus } from '../lib/confirm.ts'

test('a question and its consequence become the title and the message', () => {
  assert.deepEqual(confirmCopy('Delete this post? This cannot be undone.'), {
    title: 'Delete this post?',
    message: 'This cannot be undone.',
  })
  assert.deepEqual(confirmCopy("Block @ada? You will stop seeing each other's posts."), {
    title: 'Block @ada?',
    message: "You will stop seeing each other's posts.",
  })
})

test('a question alone is the title', () => {
  assert.deepEqual(confirmCopy('Stop @ada moderating Lagos?'), { title: 'Stop @ada moderating Lagos?', message: null })
  assert.deepEqual(confirmCopy('No question here.'), { title: 'No question here.', message: null })
})

test('a title given outright keeps the whole message under it', () => {
  assert.deepEqual(confirmCopy('It counts as a loss.', 'Resign this game?'), {
    title: 'Resign this game?',
    message: 'It counts as a loss.',
  })
})

test('confirming answers yes once the dialog has closed', () => {
  const pressed = confirmStep('asking', 'confirm')
  assert.deepEqual(pressed, { flow: 'confirmed', close: true, answer: null })
  assert.deepEqual(confirmStep(pressed.flow, 'closed'), { flow: 'done', close: false, answer: 'confirm' })
})

test('Cancel, the scrim and Esc all answer no', () => {
  const dismissed = confirmStep('asking', 'dismiss')
  assert.deepEqual(dismissed, { flow: 'asking', close: true, answer: null })
  // Esc closes the dialog itself, so only the close arrives.
  assert.deepEqual(confirmStep('asking', 'closed'), { flow: 'done', close: false, answer: 'cancel' })
})

test('a second press on the confirm button does not answer twice', () => {
  assert.deepEqual(confirmStep('confirmed', 'confirm'), { flow: 'confirmed', close: false, answer: null })
  assert.deepEqual(confirmStep('done', 'confirm'), { flow: 'done', close: false, answer: null })
  assert.deepEqual(confirmStep('done', 'closed'), { flow: 'done', close: false, answer: null })
})

test('a press on Cancel after confirming does not take the yes back', () => {
  assert.deepEqual(confirmStep('confirmed', 'dismiss'), { flow: 'confirmed', close: false, answer: null })
  assert.equal(confirmStep('confirmed', 'closed').answer, 'confirm')
})

test('Tab goes round inside the dialog', () => {
  assert.equal(wrapFocus(2, 1, false), 0)
  assert.equal(wrapFocus(2, 0, true), 1)
  assert.equal(wrapFocus(4, 3, false), 0)
  // In the middle the browser moves focus itself.
  assert.equal(wrapFocus(4, 1, false), null)
  assert.equal(wrapFocus(4, 2, true), null)
  // Focus on the dialog itself, not on a control.
  assert.equal(wrapFocus(2, -1, true), 1)
  assert.equal(wrapFocus(2, -1, false), 0)
  assert.equal(wrapFocus(0, -1, false), null)
})

test('a question mark inside a name does not end the question', () => {
  // A question that ends in a name cannot be told apart from a question and a reply, so it comes as the title.
  assert.deepEqual(confirmCopy('', 'Stop @ada moderating Who? Me?'), { title: 'Stop @ada moderating Who? Me?', message: null })
  assert.deepEqual(confirmCopy('Leave Who? Me? You can join again later.'), {
    title: 'Leave Who? Me?',
    message: 'You can join again later.',
  })
})

const closedAt = { x: 700, y: 430, at: 1_000, pointerType: 'mouse' }

test('the second click of a double click that closed the dialog is part of the same press', () => {
  assert.equal(continuesPress(closedAt, { x: 700, y: 430, at: 1_150, detail: 2, pointerType: 'mouse' }), true)
  assert.equal(continuesPress(closedAt, { x: 712, y: 436, at: 1_400, detail: 3, pointerType: 'mouse' }), true)
})

test('a second tap near the first, straight after it, is part of the same press', () => {
  assert.equal(continuesPress(closedAt, { x: 710, y: 440, at: 1_200, detail: 1, pointerType: 'touch' }), true)
  assert.equal(continuesPress(closedAt, { x: 700, y: 430, at: 1_200, detail: 1, pointerType: 'pen' }), true)
})

test("a mouse button pressed again in the same place straight after is the double click's second press, before the browser counts it", () => {
  assert.equal(continuesPress(closedAt, { x: 702, y: 432, at: 1_150, detail: 0, pointerType: 'mouse' }), true)
  assert.equal(continuesPress(closedAt, { x: 300, y: 432, at: 1_150, detail: 0, pointerType: 'mouse' }), false)
})

test('a click the browser does not count as a double click goes through', () => {
  assert.equal(continuesPress(closedAt, { x: 700, y: 430, at: 1_150, detail: 1, pointerType: 'mouse' }), false)
  // Keyboard clicks have no pointer and no count.
  assert.equal(continuesPress(closedAt, { x: 0, y: 0, at: 1_100, detail: 0, pointerType: '' }), false)
})

test('a tap somewhere else goes through at once', () => {
  assert.equal(continuesPress(closedAt, { x: 300, y: 430, at: 1_100, detail: 1, pointerType: 'touch' }), false)
  assert.equal(continuesPress(closedAt, { x: 700, y: 600, at: 1_100, detail: 1, pointerType: 'touch' }), false)
})

test('a deliberate press 600ms later goes through', () => {
  assert.equal(continuesPress(closedAt, { x: 700, y: 430, at: 1_600, detail: 1, pointerType: 'touch' }), false)
  assert.equal(continuesPress(closedAt, { x: 700, y: 430, at: 1_600, detail: 2, pointerType: 'mouse' }), false)
})

const tappedAt = { x: 180, y: 620, at: 1_000, pointerType: 'touch' }

test("after a tap closed it, the next tap's mousedown and click, which Safari counts 1 and gives no pointer type or 'mouse', are the same press", () => {
  assert.equal(continuesPress(tappedAt, { x: 182, y: 618, at: 1_180, detail: 1, pointerType: '' }), true)
  assert.equal(continuesPress(tappedAt, { x: 182, y: 618, at: 1_180, detail: 1, pointerType: 'mouse' }), true)
  assert.equal(continuesPress({ ...tappedAt, pointerType: 'pen' }, { x: 180, y: 620, at: 1_180, detail: 1, pointerType: '' }), true)
})

test('after a tap closed it, an uncounted mouse event somewhere else, later, or from the keyboard goes through', () => {
  assert.equal(continuesPress(tappedAt, { x: 40, y: 620, at: 1_180, detail: 1, pointerType: '' }), false)
  assert.equal(continuesPress(tappedAt, { x: 180, y: 620, at: 1_600, detail: 1, pointerType: '' }), false)
  assert.equal(continuesPress(tappedAt, { x: 180, y: 620, at: 1_100, detail: 0, pointerType: '' }), false)
  assert.equal(continuesPress(tappedAt, { x: 40, y: 620, at: 1_180, detail: 1, pointerType: 'mouse' }), false)
})

test('after a mouse click closed it, a click with no pointer type is not taken for a tap', () => {
  assert.equal(continuesPress(closedAt, { x: 700, y: 430, at: 1_150, detail: 1, pointerType: '' }), false)
})

test('the pointer that closed the dialog is the one its pointerdown named, since Safari calls a tap\'s click a mouse click', () => {
  assert.equal(pressedWith('touch', 'mouse'), 'touch')
  assert.equal(pressedWith('pen', ''), 'pen')
  assert.equal(pressedWith('', 'mouse'), 'mouse')
  assert.equal(pressedWith('', ''), '')
})

const heldAt = { x: 180, y: 620, liftedAt: null }

test('a follow-up press held past the window is stopped whole, near where it went down, while held and just after', () => {
  assert.equal(restOfHeldPress(heldAt, { x: 182, y: 618, at: 1_700, detail: 1 }), true)
  assert.equal(restOfHeldPress(heldAt, { x: 180, y: 620, at: 9_000, detail: 2 }), true)
  assert.equal(restOfHeldPress({ ...heldAt, liftedAt: 1_600 }, { x: 182, y: 618, at: 1_620, detail: 1 }), true)
})

test('a held press stops nothing far away, from the keyboard, or long after it was lifted', () => {
  assert.equal(restOfHeldPress(heldAt, { x: 40, y: 620, at: 1_700, detail: 1 }), false)
  assert.equal(restOfHeldPress(heldAt, { x: 180, y: 620, at: 1_700, detail: 0 }), false)
  assert.equal(restOfHeldPress({ ...heldAt, liftedAt: 1_600 }, { x: 180, y: 620, at: 2_200, detail: 1 }), false)
})
