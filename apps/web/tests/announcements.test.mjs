import assert from 'node:assert/strict'
import { test } from 'node:test'
import { announcementWait } from '../lib/announcements.ts'

const now = Date.parse('2026-11-13T12:00:00Z')
const at = (minutes) => new Date(now + minutes * 60_000).toISOString()

test('a community that may notify its members now has no wait', () => {
  assert.equal(announcementWait(null, now), null)
  assert.equal(announcementWait(undefined, now), null)
  assert.equal(announcementWait(at(0), now), null)
  assert.equal(announcementWait(at(-5), now), null)
  assert.equal(announcementWait('soon', now), null)
})

test('the wait is said in whole hours', () => {
  assert.equal(announcementWait(at(10), now), 'in less than an hour')
  assert.equal(announcementWait(at(29), now), 'in less than an hour')
  assert.equal(announcementWait(at(45), now), 'in about an hour')
  assert.equal(announcementWait(at(89), now), 'in about an hour')
  assert.equal(announcementWait(at(5 * 60 + 10), now), 'in about 5 hours')
  assert.equal(announcementWait(at(24 * 60), now), 'in about 24 hours')
})
