import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { CONSTITUTION, COUNCIL_PROPOSAL, MILESTONE_LABEL, OWNERSHIP_MILESTONES, PROPOSED_THRESHOLDS } from '../lib/governance.ts'
import { CONSTITUTION_SECTIONS } from '../lib/constitution.ts'

test('a milestone can only be marked completed with public evidence', () => {
  for (const milestone of OWNERSHIP_MILESTONES) {
    if (milestone.status === 'completed') {
      assert.match(milestone.evidence ?? '', /^https:\/\//, `${milestone.id} is completed without evidence`)
    }
  }
})

test('ownership has not transferred: the final steps are not complete', () => {
  const byId = Object.fromEntries(OWNERSHIP_MILESTONES.map((m) => [m.id, m]))
  for (const id of ['entity', 'legal-membership', 'community-representation', 'first-trustee-election', 'transfer', 'proof']) {
    assert.notEqual(byId[id].status, 'completed', id)
  }
})

test('the milestones distinguish the seven legal and democratic phases in Article 13', () => {
  assert.deepEqual(
    OWNERSHIP_MILESTONES.map((m) => m.id),
    ['founding-association', 'entity', 'legal-membership', 'community-representation', 'first-trustee-election', 'transfer', 'proof'],
  )
  for (const m of OWNERSHIP_MILESTONES) assert.ok(MILESTONE_LABEL[m.status], m.id)
})

test('representation activation is separate from the founding-term trustee election', () => {
  assert.deepEqual(COUNCIL_PROPOSAL.trustees, {
    seats: 3, termYears: 3, staggered: false, foundingTermStarts: 'incorporation', firstElection: 'founding-term-expiry',
  })
  assert.deepEqual(COUNCIL_PROPOSAL.representatives, { seats: 2, termYears: 1, firstElection: 'governance-readiness' })
  assert.equal(COUNCIL_PROPOSAL.trustees.seats + COUNCIL_PROPOSAL.representatives.seats, 5)
  const elections = PROPOSED_THRESHOLDS.filter((row) => /elections/.test(row.decision))
  assert.equal(elections.length, 2)
  assert.match(elections[0].approval, /three choices/)
  assert.match(elections[1].approval, /two choices/)
})

test('all constitution text published on the website appears in the CAC review copy', async () => {
  const copy = await readFile(new URL('../../../docs/governance/cac-constitution.md', import.meta.url), 'utf8')
  assert.ok(copy.includes(CONSTITUTION.label))
  assert.equal(CONSTITUTION_SECTIONS.filter((section) => section.id.startsWith('article-')).length, 14)
  for (const section of CONSTITUTION_SECTIONS) {
    for (const clause of section.clauses) assert.ok(copy.includes(clause), section.id)
  }
})

test('the constitution says it is a draft, and its history covers the current version', () => {
  assert.match(CONSTITUTION.label, /^Draft v/)
  assert.match(CONSTITUTION.status, /not yet adopted/i)
  assert.equal(CONSTITUTION.changelog.at(-1).version, CONSTITUTION.version)
})
