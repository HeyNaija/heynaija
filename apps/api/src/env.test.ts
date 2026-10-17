import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEnv } from './env.js'

const base = {
  DATABASE_URL: 'postgres://localhost/heynaija',
  KRATOS_PUBLIC_URL: 'http://127.0.0.1:4533',
  KRATOS_WEBHOOK_SECRET: 'x'.repeat(32),
  REDIS_URL: 'redis://127.0.0.1:6380',
  S3_ENDPOINT: 'http://127.0.0.1:9100',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_UPLOADS_BUCKET: 'uploads',
  S3_MEDIA_BUCKET: 'media',
}

const locked = ['NIN_VERIFICATION_ENABLED', 'BINDING_GOVERNANCE_VOTING_ENABLED', 'UNDER_18_ACCOUNTS_ENABLED'] as const

test('identity checks, binding votes and under-18 accounts are off by default', () => {
  const env = loadEnv(base)
  for (const name of locked) assert.equal(env[name], false, name)
  assert.equal(env.IDENTITY_KEY_SECRET, undefined)
})

test('"false" is accepted for each locked switch', () => {
  for (const name of locked) assert.equal(loadEnv({ ...base, [name]: 'false' })[name], false)
})

test('the API refuses to start with any of them switched on', () => {
  for (const name of locked) {
    assert.throws(() => loadEnv({ ...base, [name]: 'true' }), new RegExp(`${name} cannot be enabled yet`))
    // Anything that is not exactly "false" is refused too, rather than read as off.
    assert.throws(() => loadEnv({ ...base, [name]: '1' }))
  }
})

test('the person-key secret must be long enough when given', () => {
  assert.throws(() => loadEnv({ ...base, IDENTITY_KEY_SECRET: 'short' }))
  assert.equal(loadEnv({ ...base, IDENTITY_KEY_SECRET: 'k'.repeat(32) }).IDENTITY_KEY_SECRET, 'k'.repeat(32))
})
