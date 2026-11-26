import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confirmCopy, confirmStep, wrapFocus } from '../lib/confirm.ts'

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
