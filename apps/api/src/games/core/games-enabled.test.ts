import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ExecutionContext, type HttpException, NotFoundException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { SessionGuard } from '../../auth/session.guard.js'
import { GamesController } from './games.controller.js'
import { GamesEnabledGuard, gamesEnabled, gamesFeatureFor } from './games-enabled.js'

const env = (over: { GAMES_ENABLED?: boolean; GAMES_MEMBERS?: string[] } = {}) => ({ GAMES_ENABLED: true, GAMES_MEMBERS: ['ada'], ...over })
const req = (handle: string) => ({ method: 'GET', url: '/v1/games', member: { id: 'm', handle } }) as never

const context = () => ({ switchToHttp: () => ({ getRequest: () => ({ method: 'GET', url: '/v1/games' }) }) }) as unknown as ExecutionContext

const refusal = (run: () => unknown): HttpException | undefined => {
  try {
    run()
  } catch (err) {
    return err as HttpException
  }
  return undefined
}

test('Games are off by default and on only with the switch', () => {
  assert.equal(gamesEnabled(env()), true)
  assert.equal(gamesEnabled(env({ GAMES_ENABLED: false })), false)
})

test('with the switch off the route answers 404 in the same words as a route that does not exist', () => {
  const err = refusal(() => new GamesEnabledGuard(env({ GAMES_ENABLED: false })).canActivate(context()))
  assert.ok(err instanceof NotFoundException)
  assert.deepEqual(err.getResponse(), { message: 'Cannot GET /v1/games', error: 'Not Found', statusCode: 404 })
  assert.equal(refusal(() => new GamesEnabledGuard(env()).canActivate(context())), undefined)
})

test('the switch is checked before sign-in', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, GamesController), [GamesEnabledGuard, SessionGuard])
})

test('only allow-listed handles see Games, and an empty list means nobody', () => {
  assert.equal(gamesFeatureFor(env(), { handle: 'ada' }), true)
  assert.equal(gamesFeatureFor(env(), { handle: 'ADA' }), true)
  assert.equal(gamesFeatureFor(env(), { handle: 'bayo' }), false)
  assert.equal(gamesFeatureFor(env({ GAMES_MEMBERS: [] }), { handle: 'ada' }), false)
  assert.equal(gamesFeatureFor(env({ GAMES_ENABLED: false }), { handle: 'ada' }), false)
})

test('GET /v1/games lists the registry for allow-listed members and is a 404 for everyone else', () => {
  const controller = new GamesController(env())
  assert.deepEqual(
    controller.list(req('ada')).games.map((game) => game.slug),
    ['chess', 'keno'],
  )
  const err = refusal(() => controller.list(req('bayo')))
  assert.ok(err instanceof NotFoundException)
  assert.deepEqual(err.getResponse(), { message: 'Cannot GET /v1/games', error: 'Not Found', statusCode: 404 })
})
