import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONSTITUTION, MILESTONE_LABEL, OWNERSHIP_MILESTONES } from '../lib/governance.ts'

test('a milestone can only be marked completed with public evidence', () => {
  for (const milestone of OWNERSHIP_MILESTONES) {
    if (milestone.status === 'completed') {
      assert.match(milestone.evidence ?? '', /^https:\/\//, `${milestone.id} is completed without evidence`)
    }
  }
})

test('ownership has not transferred: the final steps are not complete', () => {
  const byId = Object.fromEntries(OWNERSHIP_MILESTONES.map((m) => [m.id, m]))
  for (const id of ['entity', 'first-election', 'transfer', 'proof']) {
    assert.notEqual(byId[id].status, 'completed', id)
  }
})

test('the milestones follow the order proposed in Article 13.2', () => {
  assert.deepEqual(
    OWNERSHIP_MILESTONES.map((m) => m.id),
    ['drafts', 'consultation', 'legal-review', 'entity', 'first-election', 'transfer', 'proof'],
  )
  for (const m of OWNERSHIP_MILESTONES) assert.ok(MILESTONE_LABEL[m.status], m.id)
})

test('the constitution says it is a draft, and its history covers the current version', () => {
  assert.match(CONSTITUTION.label, /^Draft v/)
  assert.match(CONSTITUTION.status, /not yet adopted/i)
  assert.equal(CONSTITUTION.changelog.at(-1).version, CONSTITUTION.version)
})
