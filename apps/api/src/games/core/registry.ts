import { chessManifest } from '../chess/manifest.js'
import { kenoManifest } from '../keno/manifest.js'
import type { GameManifest } from './manifest.js'

/**
 * Every game, in the order the games homepage shows them. Adding a game means a
 * folder beside chess/ and keno/ and a line here; game slugs in the `games`
 * schema are plain text, so no migration (docs/adr/0018).
 */
export const GAME_REGISTRY: readonly GameManifest[] = [chessManifest, kenoManifest]

/** The game with this slug, or undefined: services check slugs here, never in the database. */
export const gameBySlug = (slug: string): GameManifest | undefined => GAME_REGISTRY.find((game) => game.slug === slug)
