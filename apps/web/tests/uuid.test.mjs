import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUuid } from '../lib/uuid.ts'

test('only a whole canonical UUID passes', () => {
  assert.equal(isUuid('0b9f3c2e-7a41-4d8e-9c55-1f2a3b4c5d6e'), true)
  assert.equal(isUuid('0B9F3C2E-7A41-4D8E-9C55-1F2A3B4C5D6E'), true)
  for (const bad of ['', 'abc', ' 0b9f3c2e-7a41-4d8e-9c55-1f2a3b4c5d6e', '0b9f3c2e-7a41-4d8e-9c55-1f2a3b4c5d6e\n', '0b9f3c2e-7a41-4d8e-9c55-1f2a3b4c5d6ez']) assert.equal(isUuid(bad), false, JSON.stringify(bad))
})
