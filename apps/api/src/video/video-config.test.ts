import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadEnv } from '../env.js'
import { LIMITS } from '../rate-limit.js'
import { DEFAULT_VIDEO_CONFIG, videoConfig } from './video-config.js'
import { loadWorkerEnv, workerVideoConfig } from './worker-env.js'

const base = {
  DATABASE_URL: 'postgres://localhost/heynaija',
  KRATOS_PUBLIC_URL: 'http://127.0.0.1:4533',
  KRATOS_ADMIN_URL: 'http://127.0.0.1:4534',
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

test('the length limit cannot exceed what the 80-frame scan sample can cover (one frame a second and the last)', () => {
  assert.equal(videoConfig(loadEnv({ ...base, VIDEO_MAX_SECONDS: '78' })).maxSeconds, 78)
  assert.throws(() => loadEnv({ ...base, VIDEO_MAX_SECONDS: '79' }))
  assert.throws(() => loadEnv({ ...base, VIDEO_MAX_SECONDS: '600' }))
})

test('VIDEO_KEEP_ORIGINALS empty (what compose passes when it is unset) is the default, false, for the API and the worker', () => {
  assert.equal(videoConfig(loadEnv({ ...base, VIDEO_KEEP_ORIGINALS: '' })).keepOriginals, false)
  assert.equal(workerVideoConfig(loadWorkerEnv({ ...workerBase, VIDEO_KEEP_ORIGINALS: '' })).keepOriginals, false)
  assert.equal(videoConfig(loadEnv({ ...base, VIDEO_KEEP_ORIGINALS: 'true' })).keepOriginals, true)
})

const workerBase = { DATABASE_URL: base.DATABASE_URL, REDIS_URL: base.REDIS_URL, S3_ENDPOINT: base.S3_ENDPOINT, S3_REGION: 'auto', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_UPLOADS_BUCKET: 'u', S3_MEDIA_BUCKET: 'm' }

/** Every `NAME: ${NAME:-}` in infra/deploy/compose.yml: what compose passes as "" when .env leaves it unset. */
const emptyFromCompose = (service: 'api' | 'video-worker'): Record<string, string> => {
  const text = readFileSync(new URL('../../../../infra/deploy/compose.yml', import.meta.url), 'utf8')
  // The API's variables are the shared `x-api-env` anchor; the worker's are its own block.
  const start = service === 'api' ? text.indexOf('x-api-env:') : text.indexOf('  video-worker:')
  const end = service === 'api' ? text.indexOf('\nservices:') : text.indexOf('\n  migrate:')
  const out: Record<string, string> = {}
  for (const m of text.slice(start, end).matchAll(/^\s+([A-Z][A-Z0-9_]*): \$\{[A-Z0-9_]+:-\}\s*$/gm)) out[m[1]!] = ''
  return out
}

test('the exact environment compose passes with every optional setting unset (all empty) boots the API and the worker', () => {
  const api = emptyFromCompose('api')
  const worker = emptyFromCompose('video-worker')
  assert.ok('VIDEO_KEEP_ORIGINALS' in api && 'VIDEO_KEEP_ORIGINALS' in worker && Object.keys(api).length > 10, 'the compose file was read')
  assert.doesNotThrow(() => loadEnv({ ...base, ...api }))
  assert.doesNotThrow(() => loadWorkerEnv({ ...workerBase, ...worker }))
})
