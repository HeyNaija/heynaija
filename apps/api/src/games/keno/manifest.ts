import type { GameManifest } from '../core/manifest.js'

// Free to play only: tokens and points are never bought, transferred or redeemed (docs/games/GAMES.md).
export const kenoManifest: GameManifest = {
  slug: 'keno',
  name: 'Keno',
  tagline: 'Free daily draws. No money, ever',
  description:
    'Pick up to 10 numbers from 1 to 80 and watch the shared draw every few minutes. Tokens are free each day, and nothing can be bought or won.',
  cover: null,
  status: 'coming_soon',
  rankingType: 'points',
  supportsCompetitions: true,
}
