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

test('GET /v1/games lists the registry, without the providers', () => {
  const { games } = new GamesController().list()
  assert.deepEqual(
    games.map((game) => [game.slug, game.status]),
    [
      ['chess', 'beta'],
      ['keno', 'coming_soon'],
    ],
  )
  for (const game of games) assert.equal('providers' in game, false)
})
