import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportPostHref } from '../lib/report-href.ts'

test('reporting a post opens the report page for that post', () => {
  assert.equal(reportPostHref('p1'), '/report?post=p1')
  assert.equal(reportPostHref('p1', null), '/report?post=p1')
})

test('reporting a Gist reply names the Gist, because the post page does not serve it', () => {
  assert.equal(reportPostHref('r1', 'g1'), '/report?post=r1&gist=g1')
})
