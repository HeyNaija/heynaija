import assert from 'node:assert/strict'
import { test } from 'node:test'
import { topicCounts, topicPeriod } from '../lib/topics.ts'

const rules = { windowDays: 7, minMembers: 3, refreshSeconds: 60 }

test('a topic says how many members and posts put it there, and over what time', () => {
  assert.equal(topicCounts({ tag: 'a', label: 'A', members: 3, posts: 1 }, rules), '3 members · 1 post this week')
  assert.equal(topicCounts({ tag: 'a', label: 'A', members: 1200, posts: 4500 }, rules), '1,200 members · 4,500 posts this week')
  assert.equal(topicCounts({ tag: 'a', label: 'A', members: 1, posts: 2 }, { ...rules, windowDays: 3 }), '1 member · 2 posts in the last 3 days')
})

test('the window reads as people say it', () => {
  assert.equal(topicPeriod(1), 'today')
  assert.equal(topicPeriod(7), 'this week')
  assert.equal(topicPeriod(14), 'in the last 14 days')
})
