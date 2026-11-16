import type { GameManifest } from '../core/manifest.js'

// Free to play, like every game here: points count for the leaderboards and nothing else (docs/games/GAMES.md).
export const triviaManifest: GameManifest = {
  slug: 'trivia',
  name: 'Trivia',
  tagline: 'Quick questions, and who answers first',
  description:
    'A host asks the questions, one at a time, and everyone answers at once. Answers stay hidden until time is up, and the first right answer scores most.',
  cover: null,
  status: 'beta',
  rankingType: 'points',
  supportsCompetitions: false,
  flag: 'trivia',
}
