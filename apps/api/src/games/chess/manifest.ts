import type { GameManifest } from '../core/manifest.js'

// Lichess owns chess, ratings and anti-cheat; HeyNaija owns the social layer (docs/games/GAMES.md).
export const chessManifest: GameManifest = {
  slug: 'chess',
  name: 'Chess',
  tagline: 'Play other members on Lichess',
  description:
    'Link your Lichess account, challenge other members and follow their games here. Lichess runs the games and the ratings.',
  cover: null,
  status: 'beta',
  rankingType: 'rating',
  supportsCompetitions: true,
}
