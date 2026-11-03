import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GAME_STATUSES, publicManifest } from './manifest.js'
import { GAME_REGISTRY, gameBySlug } from './registry.js'

test('every game has a unique slug and a valid status', () => {
  const slugs = GAME_REGISTRY.map((game) => game.slug)
  assert.equal(new Set(slugs).size, slugs.length)
  for (const game of GAME_REGISTRY) {
    assert.match(game.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/)
    assert.ok(GAME_STATUSES.includes(game.status), `${game.slug}: ${game.status}`)
    assert.ok(game.name && game.tagline && game.description, `${game.slug} needs a name, tagline and description`)
  }
})

test('the launch games are chess (beta: played on lichess.org until phase 3) and keno (coming soon)', () => {
  assert.deepEqual(
    GAME_REGISTRY.map((game) => [game.slug, game.status, game.rankingType]),
    [
      ['chess', 'beta', 'rating'],
      ['keno', 'coming_soon', 'points'],
    ],
  )
})

test('a coming-soon game has no providers, and providers never reach the browser', () => {
  for (const game of GAME_REGISTRY.filter((g) => g.status === 'coming_soon')) assert.equal(game.providers, undefined)
  const stub = { stats: async () => null, leaderboard: async () => [] }
  assert.equal('providers' in publicManifest({ ...GAME_REGISTRY[0]!, providers: stub }), false)
})

test('slugs are looked up in the registry', () => {
  assert.equal(gameBySlug('keno')?.name, 'Keno')
  assert.equal(gameBySlug('poker'), undefined)
})
