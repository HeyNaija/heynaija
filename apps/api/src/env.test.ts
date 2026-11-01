import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEnv, loadPrivacyToolEnv } from './env.js'

const base = {
  DATABASE_URL: 'postgres://localhost/heynaija',
  KRATOS_PUBLIC_URL: 'http://127.0.0.1:4533',
  KRATOS_WEBHOOK_SECRET: 'x'.repeat(32),
  KRATOS_ADMIN_URL: 'http://127.0.0.1:4534',
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

test('notification emails are off without an SMTP account, and need a sender with one', () => {
  const off = loadEnv(base)
  assert.equal(off.SMTP_CONNECTION_URI, undefined)
  assert.equal(off.SMTP_FROM_NAME, 'HeyNaija')
  assert.equal(off.EMAIL_DIGEST_DELAY_S, 300)
  assert.equal(off.EMAIL_DIGEST_GAP_S, 1800)
  assert.equal(off.EMAIL_SWEEP_EVERY_S, 60)

  const smtp = { ...base, SMTP_CONNECTION_URI: 'smtp://127.0.0.1:1026' }
  assert.throws(() => loadEnv(smtp), /SMTP_FROM_ADDRESS is required/)
  assert.equal(loadEnv({ ...smtp, SMTP_FROM_ADDRESS: 'no-reply@heynaija.test' }).SMTP_FROM_ADDRESS, 'no-reply@heynaija.test')
  assert.throws(() => loadEnv({ ...smtp, SMTP_FROM_ADDRESS: 'not an address' }))
})

test('Kratos’s admin address is always required, since deleting an account needs it', () => {
  const { KRATOS_ADMIN_URL: _admin, ...without } = base
  assert.throws(() => loadEnv(without), /KRATOS_ADMIN_URL/)
  assert.throws(() => loadEnv({ ...base, KRATOS_ADMIN_URL: 'kratos' }), /KRATOS_ADMIN_URL/)
  assert.equal(loadEnv({ ...base, KRATOS_ADMIN_URL: 'http://kratos:4434/' }).KRATOS_ADMIN_URL, 'http://kratos:4434')
})

test('account deletion waits 14 days and requests are due in 30 unless set, also when given empty', () => {
  const unset = loadEnv(base)
  assert.equal(unset.ACCOUNT_DELETION_GRACE_DAYS, 14)
  assert.equal(unset.PRIVACY_REQUEST_DUE_DAYS, 30)
  // What compose passes when the server's .env leaves them out: not 0, which would erase at once.
  const empty = loadEnv({ ...base, ACCOUNT_DELETION_GRACE_DAYS: '', PRIVACY_REQUEST_DUE_DAYS: '' })
  assert.equal(empty.ACCOUNT_DELETION_GRACE_DAYS, 14)
  assert.equal(empty.PRIVACY_REQUEST_DUE_DAYS, 30)

  assert.equal(loadEnv({ ...base, ACCOUNT_DELETION_GRACE_DAYS: '0' }).ACCOUNT_DELETION_GRACE_DAYS, 0)
  assert.equal(loadEnv({ ...base, ACCOUNT_DELETION_GRACE_DAYS: '30', PRIVACY_REQUEST_DUE_DAYS: '90' }).PRIVACY_REQUEST_DUE_DAYS, 90)
  for (const bad of ['31', '-1', '1.5', 'two weeks']) {
    assert.throws(() => loadEnv({ ...base, ACCOUNT_DELETION_GRACE_DAYS: bad }), /ACCOUNT_DELETION_GRACE_DAYS/, bad)
  }
  for (const bad of ['0', '91', 'soon']) {
    assert.throws(() => loadEnv({ ...base, PRIVACY_REQUEST_DUE_DAYS: bad }), /PRIVACY_REQUEST_DUE_DAYS/, bad)
  }
  // The erase may not come after the request is due.
  assert.throws(() => loadEnv({ ...base, ACCOUNT_DELETION_GRACE_DAYS: '20', PRIVACY_REQUEST_DUE_DAYS: '14' }), /must not be more than PRIVACY_REQUEST_DUE_DAYS/)
  assert.equal(loadEnv({ ...base, ACCOUNT_DELETION_GRACE_DAYS: '14', PRIVACY_REQUEST_DUE_DAYS: '14' }).ACCOUNT_DELETION_GRACE_DAYS, 14)
})

test('deleted posts keep their text until a retention period is set', () => {
  assert.equal(loadEnv(base).DELETED_CONTENT_RETENTION_DAYS, undefined)
  assert.equal(loadEnv({ ...base, DELETED_CONTENT_RETENTION_DAYS: '' }).DELETED_CONTENT_RETENTION_DAYS, undefined)
  assert.equal(loadEnv({ ...base, DELETED_CONTENT_RETENTION_DAYS: '180' }).DELETED_CONTENT_RETENTION_DAYS, 180)
  for (const bad of ['0', '3651', 'forever']) {
    assert.throws(() => loadEnv({ ...base, DELETED_CONTENT_RETENTION_DAYS: bad }), /DELETED_CONTENT_RETENTION_DAYS/, bad)
  }
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

test('the safety settings are optional, also when given empty, and the Cloudflare purge needs both halves', () => {
  const off = loadEnv({ ...base, SAFETY_ALERT_EMAIL: '', PHOTODNA_SUBSCRIPTION_KEY: '', CLOUDFLARE_ZONE_ID: '', CLOUDFLARE_PURGE_TOKEN: '', MEDIA_ORIGIN: '' })
  assert.deepEqual(
    [off.SAFETY_ALERT_EMAIL, off.PHOTODNA_SUBSCRIPTION_KEY, off.CLOUDFLARE_ZONE_ID, off.CLOUDFLARE_PURGE_TOKEN, off.MEDIA_ORIGIN],
    [undefined, undefined, undefined, undefined, undefined],
  )
  const zone = '0123456789abcdef0123456789abcdef'
  assert.throws(() => loadEnv({ ...base, CLOUDFLARE_ZONE_ID: zone }), /set both CLOUDFLARE_ZONE_ID and CLOUDFLARE_PURGE_TOKEN/)
  assert.throws(() => loadEnv({ ...base, CLOUDFLARE_ZONE_ID: 'heynaija.ng', CLOUDFLARE_PURGE_TOKEN: 't' }), /a Cloudflare zone ID/)
  const on = loadEnv({ ...base, CLOUDFLARE_ZONE_ID: zone, CLOUDFLARE_PURGE_TOKEN: 't', MEDIA_ORIGIN: 'https://media.heynaija.ng/' })
  assert.equal(on.MEDIA_ORIGIN, 'https://media.heynaija.ng')
  // An alert address alone would send nothing, so it is refused rather than silently ignored.
  assert.throws(() => loadEnv({ ...base, SAFETY_ALERT_EMAIL: 'contact@heynaija.ng' }), /needs SMTP_CONNECTION_URI/)
})

test('the privacy-request command needs no storage keys, and checks the deletion days as the API does', () => {
  const tool = { DATABASE_URL: base.DATABASE_URL, REDIS_URL: base.REDIS_URL, KRATOS_ADMIN_URL: base.KRATOS_ADMIN_URL }
  const env = loadPrivacyToolEnv(tool)
  assert.deepEqual([env.ACCOUNT_DELETION_GRACE_DAYS, env.PRIVACY_REQUEST_DUE_DAYS, env.SMTP_CONNECTION_URI], [14, 30, undefined])
  assert.equal('S3_SECRET_ACCESS_KEY' in env, false)
  assert.throws(() => loadPrivacyToolEnv({ ...tool, ACCOUNT_DELETION_GRACE_DAYS: '20', PRIVACY_REQUEST_DUE_DAYS: '10' }), /must not be more than/)
  assert.throws(() => loadPrivacyToolEnv({ DATABASE_URL: base.DATABASE_URL, REDIS_URL: base.REDIS_URL }), /KRATOS_ADMIN_URL/)
})

test('calls and Gists are off by default, with nobody on the allow-list', () => {
  const env = loadEnv(base)
  assert.equal(env.CALLS_ENABLED, false)
  assert.equal(env.CALLS_GISTS_ENABLED, false)
  assert.deepEqual(env.CALLS_MEMBERS, [])
  assert.equal(env.LIVEKIT_URL, undefined)
  assert.equal(env.GISTS_LISTENER_CAP, 200)
  assert.equal(env.GISTS_MAX_COHOSTS, 2)
  assert.equal(env.GISTS_MAX_SPEAKERS, 10)
})

test('the Gists switches accept only true or false, and the allow-list is a trimmed, lower-cased handle list', () => {
  assert.equal(loadEnv({ ...base, CALLS_ENABLED: 'true', CALLS_GISTS_ENABLED: 'true' }).CALLS_GISTS_ENABLED, true)
  assert.throws(() => loadEnv({ ...base, CALLS_ENABLED: '1' }))
  assert.deepEqual(loadEnv({ ...base, CALLS_MEMBERS: ' Ada, bayo ,,' }).CALLS_MEMBERS, ['ada', 'bayo'])
})

test('LiveKit settings may be empty (compose passes them empty), and key and secret come as a pair', () => {
  const empty = loadEnv({ ...base, LIVEKIT_URL: '', LIVEKIT_API_KEY: '', LIVEKIT_API_SECRET: '', LIVEKIT_WEBHOOK_KEY: '', LIVEKIT_WEBHOOK_SECRET: '' })
  assert.equal(empty.LIVEKIT_URL, undefined)
  const set = loadEnv({ ...base, LIVEKIT_URL: 'wss://rtc.example.com/', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's'.repeat(32) })
  assert.equal(set.LIVEKIT_URL, 'wss://rtc.example.com')
  assert.throws(() => loadEnv({ ...base, LIVEKIT_API_KEY: 'k' }), /LIVEKIT_API_KEY and LIVEKIT_API_SECRET/)
  assert.throws(() => loadEnv({ ...base, LIVEKIT_WEBHOOK_KEY: 'k' }), /LIVEKIT_WEBHOOK_KEY and LIVEKIT_WEBHOOK_SECRET/)
  assert.throws(() => loadEnv({ ...base, LIVEKIT_URL: 'http://rtc.example.com' }))
})

test('APP_ENV names the environment and, unset, is production so a forgotten variable never switches an unlaunched feature on', () => {
  assert.equal(loadEnv(base).APP_ENV, 'production')
  assert.equal(loadEnv({ ...base, APP_ENV: '' }).APP_ENV, 'production')
  for (const name of ['development', 'staging', 'production'] as const) assert.equal(loadEnv({ ...base, APP_ENV: name }).APP_ENV, name)
  assert.throws(() => loadEnv({ ...base, APP_ENV: 'prod' }))
})
