import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpException, NotFoundException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { CallsEnabledGuard } from '../calls/calls-enabled.guard.js'
import { LiveKitWebhookController } from '../gists/gists.controller.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { MeetingsController } from './meetings.controller.js'
import { MeetingError } from './meetings.service.js'

const member = { id: 'm', handle: 'ada' }
const req = (method = 'POST', url = '/v1/meetings') => ({ method, url, member }) as never
const uuid = '11111111-1111-4111-8111-111111111111'

test('every meetings route starts with the calls flag guard, before sign-in', () => {
  const names = Object.getOwnPropertyNames(MeetingsController.prototype).filter((n) => n !== 'constructor')
  assert.ok(names.length >= 11, String(names.length))
  for (const name of names) {
    const own =
      (Reflect.getMetadata(GUARDS_METADATA, MeetingsController.prototype[name as keyof MeetingsController]) as unknown[] | undefined) ??
      (Reflect.getMetadata(GUARDS_METADATA, MeetingsController) as unknown[])
    assert.equal(own[0], CallsEnabledGuard, `MeetingsController.${name}`)
  }
})

test('a refusal is the 404 of a missing route; the rest are plain 409s that say nothing about who or why', async () => {
  const refuse = (code: MeetingError['code']) => ({
    create: async () => {
      throw new MeetingError(code)
    },
  })
  const body = { memberIds: [uuid] }
  await assert.rejects(new MeetingsController(refuse('not_found') as never, new MemoryRateLimiter()).start(req(), body), (err: unknown) => {
    assert.ok(err instanceof NotFoundException)
    assert.deepEqual(err.getResponse(), { message: 'Cannot POST /v1/meetings', error: 'Not Found', statusCode: 404 })
    return true
  })
  for (const code of ['already_in_meeting', 'in_call', 'full', 'locked'] as const) {
    await assert.rejects(new MeetingsController(refuse(code) as never, new MemoryRateLimiter()).start(req(), body), (err: unknown) => {
      assert.equal((err as HttpException).getStatus(), 409)
      assert.equal(((err as HttpException).getResponse() as { code: string }).code, code)
      return true
    })
  }
  await assert.rejects(new MeetingsController(refuse('livekit_unavailable') as never, new MemoryRateLimiter()).start(req(), body), (err: unknown) => (err as HttpException).getStatus() === 502)
})

test('a bad body is a 400 and never reaches the service', async () => {
  let called = 0
  const controller = new MeetingsController({ create: async () => ++called, invite: async () => ++called } as never, new MemoryRateLimiter())
  await assert.rejects(controller.start(req(), { memberIds: ['x'] }))
  await assert.rejects(controller.start(req(), { memberIds: Array(8).fill(uuid), extra: 1 }))
  await assert.rejects(controller.invite(req(), uuid, { memberId: 'x' }))
  assert.equal(called, 0)
})

test('starting meetings is rate-limited per member', async () => {
  let started = 0
  const controller = new MeetingsController({ create: async () => ({ n: ++started }) } as never, new MemoryRateLimiter())
  let refused = 0
  for (let i = 0; i < 10; i++) {
    try {
      await controller.start(req(), { memberIds: [] })
    } catch (err) {
      assert.equal((err as HttpException).getStatus(), 429)
      refused++
    }
  }
  assert.equal(started, 3)
  assert.equal(refused, 7)
})

test('inviting is rate-limited per host', async () => {
  let invited = 0
  const controller = new MeetingsController({ invite: async () => ({ n: ++invited }) } as never, new MemoryRateLimiter())
  let refused = 0
  for (let i = 0; i < 40; i++) {
    try {
      await controller.invite(req(), uuid, { memberId: uuid })
    } catch {
      refused++
    }
  }
  assert.equal(invited, 30)
  assert.equal(refused, 10)
})

test('incoming for a member who cannot use calls is the 404 of a missing route', async () => {
  const refuse = {
    incoming: async () => {
      throw new MeetingError('not_found')
    },
  }
  await assert.rejects(new MeetingsController(refuse as never, new MemoryRateLimiter()).incoming(req('GET', '/v1/meetings/incoming')), NotFoundException)
})

test('the shared webhook hands each event to meetings as well as Gists and calls', async () => {
  const seen: string[] = []
  const event = { id: 'e', kind: 'room_finished', room: uuid, at: new Date() }
  const controller = new LiveKitWebhookController(
    { readWebhook: async () => event } as never,
    { handleEvent: async () => void seen.push('gists') } as never,
    { handleEvent: async () => void seen.push('calls') } as never,
    { handleEvent: async () => void seen.push('meetings') } as never,
  )
  await controller.webhook('{}', 'valid')
  assert.deepEqual(seen, ['gists', 'calls', 'meetings'])
})
