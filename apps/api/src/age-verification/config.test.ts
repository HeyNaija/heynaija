import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEnv } from '../env.js'
import { diditConfig } from './config.js'

const base = {
  DATABASE_URL: 'postgres://x',
  KRATOS_PUBLIC_URL: 'http://127.0.0.1:4433',
  KRATOS_WEBHOOK_SECRET: 'k'.repeat(32),
  REDIS_URL: 'redis://127.0.0.1:6379',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'a',
  S3_SECRET_ACCESS_KEY: 'b',
  S3_UPLOADS_BUCKET: 'uploads',
  S3_MEDIA_BUCKET: 'media',
}
const full = { DIDIT_API_KEY: 'key', DIDIT_WORKFLOW_ID: '0d8a6a8e-4a1b-4a43-8d8f-111111111111', DIDIT_WEBHOOK_SECRET: 'whsec' }

test('without any Didit settings the API still starts, and age verification is not configured', () => {
  const env = loadEnv(base)
  assert.equal(diditConfig(env), null)
})

test('empty Didit settings (compose passes empty strings) count as missing', () => {
  const env = loadEnv({ ...base, DIDIT_API_KEY: '', DIDIT_WORKFLOW_ID: '', DIDIT_WEBHOOK_SECRET: '' })
  assert.equal(diditConfig(env), null)
})

test('all three settings give a config', () => {
  const env = loadEnv({ ...base, ...full })
  assert.deepEqual(diditConfig(env), {
    apiKey: 'key',
    workflowId: '0d8a6a8e-4a1b-4a43-8d8f-111111111111',
    webhookSecret: 'whsec',
    callbackUrl: 'http://127.0.0.1:3000/settings/age-verification',
  })
})

test('any one missing fails closed: no config, and no crash', () => {
  for (const missing of Object.keys(full)) {
    const { [missing]: _gone, ...rest } = full as Record<string, string>
    assert.equal(diditConfig(loadEnv({ ...base, ...rest })), null, missing)
  }
})

test('the callback follows WEB_PUBLIC_URL', () => {
  const env = loadEnv({ ...base, ...full, WEB_PUBLIC_URL: 'https://staging.heynaija.ng' })
  assert.equal(diditConfig(env)?.callbackUrl, 'https://staging.heynaija.ng/settings/age-verification')
})
