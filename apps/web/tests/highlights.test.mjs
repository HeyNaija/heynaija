import assert from 'node:assert/strict'
import { test } from 'node:test'
import { daysInWords, highlightsTime } from '../lib/highlights.ts'

test('the time highlights go out is said in Nigerian time, an hour ahead of UTC', () => {
  assert.equal(highlightsTime(0, 17), 'Sundays at about 6pm')
  assert.equal(highlightsTime(6, 8), 'Saturdays at about 9am')
  assert.equal(highlightsTime(3, 11), 'Wednesdays at about noon')
  assert.equal(highlightsTime(3, 0), 'Wednesdays at about 1am')
})

test('late on one day in UTC is already the next day in Lagos', () => {
  assert.equal(highlightsTime(0, 23), 'Mondays at about midnight')
  assert.equal(highlightsTime(6, 23), 'Sundays at about midnight')
  assert.equal(highlightsTime(0, 22), 'Sundays at about 11pm')
})

test('days are said as days, and long stretches as weeks', () => {
  assert.equal(daysInWords(1), '1 day')
  assert.equal(daysInWords(3), '3 days')
  assert.equal(daysInWords(7), '7 days')
  assert.equal(daysInWords(10), '10 days')
  assert.equal(daysInWords(56), '8 weeks')
})
