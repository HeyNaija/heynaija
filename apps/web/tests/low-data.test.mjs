import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DATA_MODES, dataMode, dataSaver } from '../lib/low-data.ts'

test('a stored choice is only one of the known modes', () => {
  assert.deepEqual([...DATA_MODES], ['auto', 'saver', 'full'])
  assert.equal(dataMode('saver'), 'saver')
  assert.equal(dataMode('full'), 'full')
  assert.equal(dataMode('auto'), 'auto')
  assert.equal(dataMode(undefined), 'auto')
  assert.equal(dataMode('nonsense'), 'auto')
})

test('the browser Save-Data hint decides only when the member has not chosen', () => {
  assert.equal(dataSaver('auto', 'on'), true)
  assert.equal(dataSaver('auto', null), false)
  assert.equal(dataSaver('auto', 'off'), false)
  assert.equal(dataSaver('saver', null), true)
  assert.equal(dataSaver('saver', 'off'), true)
  // An explicit "full" beats a browser that asks for less.
  assert.equal(dataSaver('full', 'on'), false)
  assert.equal(dataSaver('full', null), false)
})
