import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadEnv } from '../env.js'
import { LIMITS } from '../rate-limit.js'
import { DEFAULT_VIDEO_CONFIG, videoConfig } from './video-config.js'

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

test('the defaults are the ADR 0019 recommendations for its open questions', () => {
  assert.deepEqual(DEFAULT_VIDEO_CONFIG, {
    maxSeconds: 60,
    minSeconds: 3,
    maxBytes: 100 * 1024 * 1024,
    maxEdge: 1920,
    partBytes: 5 * 1024 * 1024,
    uploadWindowMs: 24 * 3_600_000,
    minAccountAgeDays: 7,
    upheldLookbackDays: 90,
    maxLivePerMember: 50,
    keepOriginals: false,
  })
  assert.deepEqual(videoConfig(loadEnv(base)), DEFAULT_VIDEO_CONFIG)
})

test('each limit can be set from the environment, and empty means the default (compose passes ${NAME:-})', () => {
  const env = loadEnv({ ...base, VIDEO_MAX_SECONDS: '30', VIDEO_MIN_ACCOUNT_AGE_DAYS: '0', VIDEO_KEEP_ORIGINALS: 'true', VIDEO_MAX_BYTES: '' })
  const cfg = videoConfig(env)
  assert.equal(cfg.maxSeconds, 30)
  assert.equal(cfg.minAccountAgeDays, 0)
  assert.equal(cfg.keepOriginals, true)
  assert.equal(cfg.maxBytes, DEFAULT_VIDEO_CONFIG.maxBytes)
})

test('a part size under storage’s 5 MiB minimum is refused', () => {
  assert.throws(() => loadEnv({ ...base, VIDEO_PART_BYTES: String(4 * 1024 * 1024) }))
})

test('rate limits: uploads 3 an hour and 10 a day, parts 120 a minute', () => {
  assert.deepEqual(LIMITS.videoUpload, [
    { max: 3, windowMs: 3_600_000 },
    { max: 10, windowMs: 86_400_000 },
  ])
  assert.deepEqual(LIMITS.videoPart, [{ max: 120, windowMs: 60_000 }])
})
