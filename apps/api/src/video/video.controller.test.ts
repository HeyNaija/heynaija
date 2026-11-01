import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common'
import 'reflect-metadata'
import { type AuthedRequest, OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import { MemoryRateLimiter } from '../rate-limit.js'
import { VideoPostsGuard } from './video-gate.js'
import { VideosController } from './video.controller.js'
import { VideoError, type VideoService } from './video.service.js'

const req = { member: { id: 'm1', handle: 'ada' } } as AuthedRequest
const ID = '5f0c1b6e-2f0e-4c63-9a3b-3b8f6f6b1a11'

const controller = (service: Partial<Record<keyof VideoService, unknown>> = {}, limits = new MemoryRateLimiter()) =>
  new VideosController(service as VideoService, limits)

test('every route is behind OptionalSessionGuard, then VideoPostsGuard, then SessionGuard: closed means 404 before sign-in is even asked', () => {
  assert.deepEqual(Reflect.getMetadata('__guards__', VideosController), [OptionalSessionGuard, VideoPostsGuard, SessionGuard])
})

test('start: validates the body (type, size, duration) before the service sees it', async () => {
  let called = 0
  const c = controller({ startUpload: async () => (called++, { mediaId: ID }) })
  for (const body of [{}, { contentType: 'image/png', bytes: 5 }, { contentType: 'video/mp4', bytes: 0 }, { contentType: 'video/mp4', bytes: 1.5 }, { contentType: 'video/mp4', bytes: 5, durationMs: -1 }]) {
    await assert.rejects(() => c.start(req, body), BadRequestException)
  }
  assert.equal(called, 0)
  assert.deepEqual(await c.start(req, { contentType: 'video/quicktime', bytes: 1000, durationMs: 5000 }), { mediaId: ID })
})

test('start is rate limited: 3 an hour', async () => {
  const c = controller({ startUpload: async () => ({}) })
  for (let i = 0; i < 3; i++) await c.start(req, { contentType: 'video/mp4', bytes: 10 })
  await assert.rejects(
    () => c.start(req, { contentType: 'video/mp4', bytes: 10 }),
    (err: unknown) => err instanceof HttpException && err.getStatus() === 429,
  )
})

test('the service’s refusals become HTTP answers: not found 404, not eligible 403, the rest 400 with a code', async () => {
  const fail = (code: VideoError['code']) => controller({ resumeUpload: async () => Promise.reject(new VideoError(code, 'nope')) }).resume(req, ID)
  await assert.rejects(() => fail('not_found'), NotFoundException)
  await assert.rejects(() => fail('not_eligible'), ForbiddenException)
  for (const code of ['too_large', 'bad_type', 'too_long', 'bad_parts', 'too_many_videos'] as const) {
    await assert.rejects(
      () => fail(code),
      (err: unknown) => err instanceof BadRequestException && (err.getResponse() as { code: string }).code === code,
    )
  }
})

test('a media id that is not a uuid is a 404, not an error', async () => {
  const c = controller({ status: async () => null })
  for (const run of [() => c.status(req, 'nope'), () => c.complete(req, 'nope'), () => c.resume(req, 'nope'), () => c.remove(req, 'nope')]) {
    await assert.rejects(run, NotFoundException)
  }
})

test('status of a video that is not the caller’s is a 404', async () => {
  await assert.rejects(() => controller({ status: async () => null }).status(req, ID), NotFoundException)
  assert.deepEqual(await controller({ status: async () => ({ status: 'processing' }) }).status(req, ID), { status: 'processing' })
})

test('remove: 204 when removed, a 400 when it is on a post', async () => {
  assert.equal(await controller({ remove: async () => true }).remove(req, ID), undefined)
  await assert.rejects(() => controller({ remove: async () => false }).remove(req, ID), BadRequestException)
})
