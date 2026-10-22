import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KratosLifecycleProvider } from './kratos-lifecycle.provider.js'

const provider = new KratosLifecycleProvider()

test('Kratos lifecycle payloads become provider-neutral registration data', async () => {
  assert.deepEqual(await provider.registration({
    identity_id: '11111111-1111-4111-8111-111111111111',
    invite_code: 'HN-TEST', handle: 'ada', adult_declared: true,
  }), {
    providerId: 'kratos', subject: '11111111-1111-4111-8111-111111111111',
    handle: 'ada', inviteCode: 'HN-TEST', adultDeclared: true,
  })
  assert.equal(await provider.registration({ identity_id: 'invalid' }), null)
})

test('Kratos settings callbacks normalize handle changes and reject malformed bodies', async () => {
  assert.deepEqual(await provider.settings({
    identity_id: '11111111-1111-4111-8111-111111111111', handle: 'ada_new', previous_handle: 'ada',
  }), {
    providerId: 'kratos', subject: '11111111-1111-4111-8111-111111111111',
    handle: 'ada_new', previousHandle: 'ada',
  })
  assert.equal(await provider.settings({}), null)
})
