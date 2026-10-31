import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ageVerificationView } from '../lib/age-verification.ts'

const state = (status, available = true) => ({ available, status, verified: status === 'verified' })

test('nothing on record offers the check', () => {
  const view = ageVerificationView(state('none'))
  assert.equal(view.value, 'Not verified')
  assert.equal(view.action, 'Verify your age')
})

test('a verified member is told so and offered nothing', () => {
  const view = ageVerificationView(state('verified'))
  assert.match(view.value, /verified/i)
  assert.equal(view.action, null)
})

test('a check in progress can be resumed, and one with a reviewer cannot be restarted', () => {
  assert.equal(ageVerificationView(state('pending')).action, 'Continue verifying')
  assert.equal(ageVerificationView(state('in_review')).action, null)
  assert.match(ageVerificationView(state('in_review')).detail, /review/i)
})

test('a declined or expired check says so plainly and offers another go', () => {
  for (const status of ['declined', 'expired']) {
    const view = ageVerificationView(state(status))
    assert.equal(view.action, 'Try again', status)
    assert.doesNotMatch(view.detail, /under 18|minor|child/i, status) // a miss is not a statement about their age
  }
})

test('when it is not available no action is offered, whatever the state', () => {
  assert.equal(ageVerificationView(state('none', false)).action, null)
  assert.equal(ageVerificationView(state('declined', false)).action, null)
  assert.match(ageVerificationView(state('none', false)).detail, /not available/i)
})

test('a verified member still sees it as verified when the check cannot be started', () => {
  const view = ageVerificationView(state('verified', false))
  assert.match(view.value, /verified/i)
})
