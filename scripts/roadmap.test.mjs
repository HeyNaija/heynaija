import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { AVAILABILITY, CATEGORIES, PRIORITIES, ROADMAP, STATUSES, roadmapGroups, statusCounts, validateRoadmap } from '../apps/web/lib/roadmap.ts'
import { checkRoadmap, markdownPath, renderRoadmap } from './roadmap.mjs'

const copy = () => structuredClone(ROADMAP)
const mutate = (change) => { const value = copy(); change(value); return value }

test('the registry uses defined fields, unique IDs, valid categories, priorities, statuses and availability', () => {
  assert.equal(validateRoadmap(ROADMAP), ROADMAP)
  for (const [field, choices] of Object.entries({ priority: PRIORITIES, status: STATUSES, availability: AVAILABILITY, category: CATEGORIES })) {
    assert.throws(() => validateRoadmap(mutate((r) => { r.features[0][field] = 'unrecognised' })), new RegExp(`invalid ${field}`))
    assert.ok(Object.keys(choices).length)
  }
  assert.throws(() => validateRoadmap(mutate((r) => { r.schemaVersion = 2 })), /schemaVersion/)
  assert.throws(() => validateRoadmap(mutate((r) => { r.features[1].id = r.features[0].id })), /duplicate id/)
  assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].id = 'Not a stable ID' })), /invalid or duplicate/)
  assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].name = ' ' })), /missing name/)
  assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].unexpected = 'typo' })), /unknown feature field/)
})

test('implemented features require application and test evidence, whose paths exist', () => {
  for (const feature of ROADMAP.features) {
    for (const path of feature.evidence) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), `${feature.id}: missing ${path}`)
  }
  assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].evidence = [] })), /evidence required/)
  assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].evidence = ['packages/db/src/schema.ts'] })), /implementation and test evidence/)
})

test('partial and blocked entries require a public explanation', () => {
  for (const status of ['partial', 'blocked']) {
    assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].status = status; delete r.features[0].caveat })), /public caveat/)
  }
})

test('priority and availability are independent from implementation status', () => {
  const value = mutate((r) => { r.features[0].priority = 'P3'; r.features[0].availability = 'not_live' })
  assert.equal(validateRoadmap(value).features[0].status, 'implemented')
  assert.ok(ROADMAP.features.some((feature) => feature.priority === 'P0' && feature.status !== 'implemented'))
})

test('dependencies must exist, cannot refer to themselves, and cannot form cycles', () => {
  for (const dependency of ['not-a-feature', ROADMAP.features[0].id]) {
    assert.throws(() => validateRoadmap(mutate((r) => { r.features[0].dependency = [dependency] })), /invalid dependency/)
  }
  assert.throws(() => validateRoadmap(mutate((r) => {
    r.features[0].dependency = [r.features[1].id]
    r.features[1].dependency = [r.features[0].id]
  })), /dependency cycle/)
})

test('counts and priority/category groups cover every feature exactly once', () => {
  const counts = statusCounts(ROADMAP.features)
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), ROADMAP.features.length)
  const groups = roadmapGroups(ROADMAP.features)
  assert.deepEqual(groups.map((group) => group.priority), ['P0', 'P1', 'P2', 'P3'])
  const ids = groups.flatMap((group) => group.categories.flatMap((category) => category.features.map((feature) => feature.id)))
  assert.deepEqual([...ids].sort(), ROADMAP.features.map((feature) => feature.id).sort())
})

test('generated Markdown is deterministic and has not drifted from the registry', async () => {
  await checkRoadmap()
  const markdown = await readFile(markdownPath, 'utf8')
  assert.equal(markdown, renderRoadmap(ROADMAP))
  assert.match(markdown, /Generated from `docs\/feature-roadmap.json`/)
  assert.notEqual(markdown, renderRoadmap(mutate((r) => { r.features[0].description = 'A changed description.' })))
})
