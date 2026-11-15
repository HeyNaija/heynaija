import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { SessionGuard } from '../../auth/session.guard.js'
import { FeatureGuard, featureOf } from '../../flags/feature.guard.js'
import { FLAGS, resolveFlag } from '../../flags/registry.js'
import { GamesController } from './games.controller.js'

test('every Games route needs a member and the games flag, in that order', () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, GamesController), [SessionGuard, FeatureGuard])
  assert.equal(featureOf(GamesController.prototype.list, GamesController), 'games')
})

test('the games flag is on in development and staging, off in production until launch', () => {
  assert.deepEqual(FLAGS.games.defaults, { development: true, staging: true, production: false })
})

test('an allow-list keeps Games to the members on it', () => {
  const allow = { enabled: null, allow: new Set(['ada']) }
  assert.equal(resolveFlag('games', 'staging', allow, 'ada'), true)
  assert.equal(resolveFlag('games', 'staging', allow, 'bayo'), false)
  assert.equal(resolveFlag('games', 'production', { enabled: true, allow: new Set() }, 'bayo'), true)
})

const viewer = { member: { id: 'm1' } } as never

test('GET /v1/games lists the registry, without the providers', async () => {
  const flags = { isEnabled: async () => true }
  const { games } = await new GamesController({} as never, {} as never, {} as never, flags).list(viewer)
  assert.deepEqual(
    games.map((game) => [game.slug, game.status]),
    [
      ['chess', 'beta'],
      ['keno', 'beta'],
      ['trivia', 'beta'],
    ],
  )
  for (const game of games) assert.equal('providers' in game, false)
})

test('a game with its own flag is listed only where that flag is on for the member (Trivia)', async () => {
  const asked: string[] = []
  const flags = { isEnabled: async (key: string) => (asked.push(key), key !== 'trivia') }
  const { games } = await new GamesController({} as never, {} as never, {} as never, flags as never).list(viewer)
  assert.deepEqual(games.map((g) => g.slug), ['chess', 'keno'])
  assert.deepEqual(asked, ['trivia'])
})
