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

test('auth redirects allow exact HTTPS origins and explicit loopback test issuers only', () => {
  assert.deepEqual(loadEnv(base).AUTH_EXTERNAL_REDIRECT_ORIGINS, ['https://accounts.google.com'])
  assert.deepEqual(loadEnv({ ...base, AUTH_EXTERNAL_REDIRECT_ORIGINS: 'https://accounts.google.com,http://127.0.0.1:5099' }).AUTH_EXTERNAL_REDIRECT_ORIGINS,
    ['https://accounts.google.com', 'http://127.0.0.1:5099'])
  for (const origin of ['http://evil.test', 'https://accounts.google.com/path', 'https://name:password@accounts.google.com', 'javascript:alert(1)']) {
    assert.throws(() => loadEnv({ ...base, AUTH_EXTERNAL_REDIRECT_ORIGINS: origin }))
  }
  assert.throws(() => loadEnv({ ...base, AUTH_EXTERNAL_REDIRECT_ORIGINS: '' }))
})

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

test('notification emails are off without an SMTP account, and need a sender and Kratos’s admin address with one', () => {
  const off = loadEnv(base)
  assert.equal(off.SMTP_CONNECTION_URI, undefined)
  assert.equal(off.SMTP_FROM_NAME, 'HeyNaija')
  assert.equal(off.EMAIL_DIGEST_DELAY_S, 300)
  assert.equal(off.EMAIL_DIGEST_GAP_S, 1800)
  assert.equal(off.EMAIL_SWEEP_EVERY_S, 60)

  const smtp = { ...base, SMTP_CONNECTION_URI: 'smtp://127.0.0.1:1026' }
  assert.throws(() => loadEnv(smtp), /SMTP_FROM_ADDRESS is required/)
  assert.throws(() => loadEnv({ ...smtp, SMTP_FROM_ADDRESS: 'no-reply@heynaija.test' }), /KRATOS_ADMIN_URL is required/)
  const on = loadEnv({ ...smtp, SMTP_FROM_ADDRESS: 'no-reply@heynaija.test', KRATOS_ADMIN_URL: 'http://kratos:4434/' })
  assert.equal(on.KRATOS_ADMIN_URL, 'http://kratos:4434')
  assert.throws(() => loadEnv({ ...smtp, SMTP_FROM_ADDRESS: 'not an address', KRATOS_ADMIN_URL: 'http://kratos:4434' }))
})

test('the email timings are numbers of seconds within sensible limits', () => {
  assert.equal(loadEnv({ ...base, EMAIL_DIGEST_DELAY_S: '10', EMAIL_DIGEST_GAP_S: '30', EMAIL_SWEEP_EVERY_S: '5' }).EMAIL_DIGEST_DELAY_S, 10)
  assert.throws(() => loadEnv({ ...base, EMAIL_SWEEP_EVERY_S: '0' }))
  assert.throws(() => loadEnv({ ...base, EMAIL_DIGEST_DELAY_S: '-1' }))
  assert.throws(() => loadEnv({ ...base, EMAIL_DIGEST_GAP_S: 'soon' }))
})

const vapid = { PUSH_VAPID_PUBLIC_KEY: `B${'p'.repeat(86)}`, PUSH_VAPID_PRIVATE_KEY: 'k'.repeat(43) }

test('push is off without VAPID keys, also when they are given empty, and needs both halves', () => {
  const off = loadEnv(base)
  assert.equal(off.PUSH_VAPID_PUBLIC_KEY, undefined)
  assert.equal(off.PUSH_SWEEP_EVERY_S, 10)
  assert.equal(off.PUSH_ALLOW_LOOPBACK, false)
  // What compose passes when the server's .env has no keys.
  assert.equal(loadEnv({ ...base, PUSH_VAPID_PUBLIC_KEY: '', PUSH_VAPID_PRIVATE_KEY: '' }).PUSH_VAPID_PUBLIC_KEY, undefined)
  assert.throws(() => loadEnv({ ...base, PUSH_VAPID_PUBLIC_KEY: vapid.PUSH_VAPID_PUBLIC_KEY }), /set both/)
  assert.throws(() => loadEnv({ ...base, PUSH_VAPID_PRIVATE_KEY: vapid.PUSH_VAPID_PRIVATE_KEY }), /set both/)
  assert.throws(() => loadEnv({ ...base, ...vapid, PUSH_VAPID_PRIVATE_KEY: 'too short', WEB_PUBLIC_URL: 'https://heynaija.ng' }))
})

test('push services need a mailto: or https: contact, which an https site address is', () => {
  assert.throws(() => loadEnv({ ...base, ...vapid }), /PUSH_CONTACT is required/)
  assert.equal(loadEnv({ ...base, ...vapid, WEB_PUBLIC_URL: 'https://heynaija.ng' }).PUSH_CONTACT, undefined)
  assert.equal(loadEnv({ ...base, ...vapid, PUSH_CONTACT: 'mailto:no-reply@heynaija.test' }).PUSH_CONTACT, 'mailto:no-reply@heynaija.test')
  assert.throws(() => loadEnv({ ...base, ...vapid, PUSH_CONTACT: 'http://heynaija.test' }))
})

test('the stand-in push service on this machine is only allowed while the site is on this machine too', () => {
  assert.equal(loadEnv({ ...base, PUSH_ALLOW_LOOPBACK: 'true' }).PUSH_ALLOW_LOOPBACK, true)
  assert.throws(() => loadEnv({ ...base, PUSH_ALLOW_LOOPBACK: 'true', WEB_PUBLIC_URL: 'https://staging.heynaija.ng' }), /only for a WEB_PUBLIC_URL on 127\.0\.0\.1/)
  assert.throws(() => loadEnv({ ...base, PUSH_ALLOW_LOOPBACK: 'yes' }))
})
