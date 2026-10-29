import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exactTime, formatTime, postedAt, timeAgo } from '../app/ui/time.ts'

const at = '2026-10-29T15:05:00Z'
const later = (seconds) => Date.parse(at) + seconds * 1000

test('how long ago counts up in minutes, hours and days, then gives the day', () => {
  assert.equal(timeAgo(at, later(59)), 'now')
  assert.equal(timeAgo(at, later(-30)), 'now', 'a clock a little behind the post says now, not a negative time')
  assert.equal(timeAgo(at, later(60)), '1m')
  assert.equal(timeAgo(at, later(3 * 3600 + 59)), '3h')
  assert.equal(timeAgo(at, later(6 * 86400)), '6d')
  assert.equal(timeAgo(at, later(7 * 86400)), '29 Oct')
  assert.equal(timeAgo(at, Date.parse('2027-01-05T12:00:00Z')), '29 Oct 2026', 'with the year once it is not this one')
})

test('times are on a 12-hour clock, in the zone they are told in', () => {
  assert.equal(postedAt(at), '4:05 pm · 29 Oct 2026')
  assert.equal(postedAt(at, 'Europe/London'), '3:05 pm · 29 Oct 2026')
  assert.equal(postedAt('2026-10-29T23:30:00Z'), '12:30 am · 30 Oct 2026', 'past midnight in Lagos is the next day')
  assert.equal(exactTime(at), 'Thursday, 29 October 2026 at 4:05 pm WAT')
  assert.equal(exactTime(at, 'America/New_York'), 'Thursday, 29 October 2026 at 11:05 am GMT-4')
})

test('a day or month is the one it was where the reader is', () => {
  const newYear = '2026-12-31T23:30:00Z'
  assert.equal(formatTime(newYear, 'date', 0), '1 January 2027')
  assert.equal(formatTime(newYear, 'date', 0, 'Europe/London'), '31 December 2026')
  assert.equal(formatTime(newYear, 'dayMonth', 0, 'Europe/London'), '31 December')
  assert.equal(formatTime(newYear, 'month', 0), 'January 2027')
})
