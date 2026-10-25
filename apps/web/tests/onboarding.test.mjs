import assert from 'node:assert/strict'
import { test } from 'node:test'
import { choicesFromForm, listOf, welcomePath } from '../lib/onboarding.ts'

const form = (entries) => {
  const data = new FormData()
  for (const [name, value] of entries) data.append(name, value)
  return data
}

test('the last form joins the communities from step 1 and follows everyone ticked, once each', () => {
  const sent = choicesFromForm(
    form([
      ['community', 'lagos'],
      ['community', 'building-heynaija'],
      ['community', 'lagos'],
      ['follow', 'ada'],
      ['follow', ''],
      ['follow', 'bayo'],
    ]),
  )
  assert.deepEqual(sent, { communities: ['lagos', 'building-heynaija'], follow: ['ada', 'bayo'] })
})

test('"Skip this step" on people still joins the communities, and follows nobody', () => {
  const sent = choicesFromForm(form([['community', 'lagos'], ['follow', 'ada'], ['people', 'skip']]))
  assert.deepEqual(sent, { communities: ['lagos'], follow: [] })
  assert.deepEqual(choicesFromForm(form([])), { communities: [], follow: [] })
})

test('step links carry the communities chosen so far, and an error when one went wrong', () => {
  assert.equal(welcomePath('communities', []), '/welcome')
  assert.equal(welcomePath('people', []), '/welcome?step=people')
  assert.equal(welcomePath('people', ['lagos', 'abuja']), '/welcome?step=people&c=lagos&c=abuja')
  assert.equal(welcomePath('notifications', []), '/welcome?step=notifications')
  assert.equal(welcomePath('communities', ['lagos'], 'busy'), '/welcome?c=lagos&error=busy')
})

test('names read as a sentence', () => {
  assert.equal(listOf([]), '')
  assert.equal(listOf(['Lagos']), 'Lagos')
  assert.equal(listOf(['Lagos', 'Abuja']), 'Lagos and Abuja')
  assert.equal(listOf(['Lagos', 'Abuja', 'Universities']), 'Lagos, Abuja and Universities')
})
