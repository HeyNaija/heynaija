import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DISCOVER_RULES } from '../posts/discover.js'
import { HIGHLIGHTS_RULES, openRun } from './rules.js'

// Sunday at 17:00 UTC, 6pm in Nigeria.
const sunday = { weekday: 0, hourUtc: 17 }
const at = (iso: string) => new Date(iso)

test('the run opens at the hour on its day and stays open for a day', () => {
  // 15 November 2026 is a Sunday.
  assert.equal(openRun(at('2026-11-15T16:59:59Z'), sunday), null, 'not yet')
  assert.equal(openRun(at('2026-11-15T17:00:00Z'), sunday)?.toISOString(), '2026-11-15T17:00:00.000Z')
  assert.equal(openRun(at('2026-11-15T23:30:00Z'), sunday)?.toISOString(), '2026-11-15T17:00:00.000Z')
  assert.equal(openRun(at('2026-11-16T16:59:59Z'), sunday)?.toISOString(), '2026-11-15T17:00:00.000Z', 'Monday afternoon, still open')
  assert.equal(openRun(at('2026-11-16T17:00:00Z'), sunday), null, 'closed after 24 hours')
  assert.equal(openRun(at('2026-11-19T12:00:00Z'), sunday), null, 'midweek')
})

test('a server that was away at the hour still finds the run open when it comes back', () => {
  assert.equal(openRun(at('2026-11-15T19:42:00Z'), sunday)?.toISOString(), '2026-11-15T17:00:00.000Z')
})

test('every day of the week and a run that crosses the end of a month', () => {
  // Monday 30 November 2026 at 23:00 UTC is open into Tuesday 1 December.
  const monday = { weekday: 1, hourUtc: 23 }
  assert.equal(openRun(at('2026-12-01T10:00:00Z'), monday)?.toISOString(), '2026-11-30T23:00:00.000Z')
  for (let weekday = 0; weekday < 7; weekday++) {
    const opens = openRun(at(`2026-11-${15 + weekday}T00:30:00Z`), { weekday, hourUtc: 0 })
    assert.equal(opens?.getUTCDay(), weekday)
  }
})

test('a shorter opening can be asked for', () => {
  assert.equal(openRun(at('2026-11-15T19:00:00Z'), sunday, 1), null)
  assert.ok(openRun(at('2026-11-15T17:30:00Z'), sunday, 1))
})

test('the points are Discover’s, so one set of rules says what counts as activity', () => {
  for (const key of ['conversationPoints', 'likePoints', 'repostPoints', 'followedPoints', 'followsAuthorPoints', 'joinedCommunityPoints', 'reportsToHold'] as const) {
    assert.equal(HIGHLIGHTS_RULES[key], DISCOVER_RULES[key], key)
  }
  assert.ok(HIGHLIGHTS_RULES.minPosts <= HIGHLIGHTS_RULES.maxPosts)
  assert.ok(HIGHLIGHTS_RULES.awayDays < HIGHLIGHTS_RULES.windowDays, 'someone just away long enough has something to be sent')
  assert.ok(HIGHLIGHTS_RULES.stopAfterDays > HIGHLIGHTS_RULES.windowDays)
})
