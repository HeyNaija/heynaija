import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ExecutionContext, NotFoundException } from '@nestjs/common'
import type { AppEnv } from '../env.js'
import type { FeatureFlags } from '../flags/feature-flags.js'
import { FLAGS } from '../flags/registry.js'
import { NoScanner } from '../media/media.service.js'
import { PhotoDnaScanner } from '../media/photodna.js'
import { VideoGate, VideoPostsGuard, videoPostsEffective } from './video-gate.js'

const flags = (on: boolean | Error) =>
  ({
    isEnabled: async (key: string) => {
      assert.equal(key, 'videoPosts')
      if (on instanceof Error) throw on
      return on
    },
  }) as unknown as FeatureFlags

const gate = (on: boolean | Error, env: AppEnv, scanner: NoScanner | PhotoDnaScanner = new NoScanner()) =>
  new VideoGate(flags(on), { APP_ENV: env }, scanner)

test('registry: videoPosts is off in production and on in staging and development', () => {
  assert.deepEqual(FLAGS.videoPosts.defaults, { development: true, staging: true, production: false })
})

test('effective: the flag AND (a real scanner OR not production)', () => {
  const table: [boolean, boolean, AppEnv, boolean][] = [
    // flag, scannerBound, env, expected
    [true, false, 'production', false], // the launch gate: an admin cannot flip this on
    [true, true, 'production', true],
    [false, true, 'production', false],
    [true, false, 'staging', true],
    [true, false, 'development', true],
    [false, false, 'staging', false],
  ]
  for (const [flag, bound, env, expected] of table) {
    assert.equal(videoPostsEffective(flag, bound, env), expected, `${flag} ${bound} ${env}`)
  }
})

test('production with NoScanner is closed even when an admin turned the flag on', async () => {
  assert.equal(await gate(true, 'production').isOpen('m1'), false)
  assert.equal(gate(true, 'production').effective(true), false)
  assert.equal(await gate(true, 'production', new PhotoDnaScanner('key')).isOpen('m1'), true)
  assert.equal(await gate(true, 'staging').isOpen('m1'), true)
})

test('fail closed: a flag read that throws means closed', async () => {
  assert.equal(await gate(new Error('db down'), 'staging').isOpen('m1'), false)
})

const context = (member?: { id: string }) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/v1/me/videos/upload', member }) }),
  }) as unknown as ExecutionContext

test('the guard answers like a route that does not exist, signed in or not', async () => {
  const closed = new VideoPostsGuard(gate(false, 'staging'))
  for (const member of [undefined, { id: 'm1' }]) {
    await assert.rejects(
      () => closed.canActivate(context(member)),
      (err: unknown) => err instanceof NotFoundException && /Cannot POST \/v1\/me\/videos\/upload/.test(err.message),
    )
  }
  assert.equal(await new VideoPostsGuard(gate(true, 'staging')).canActivate(context({ id: 'm1' })), true)
})

test('the guard fails closed when the flag read throws', async () => {
  const broken = new VideoPostsGuard(gate(new Error('boom'), 'staging'))
  await assert.rejects(() => broken.canActivate(context({ id: 'm1' })), NotFoundException)
})
