import Link from 'next/link'

// Every game's page has the same tabs (docs/games/GAMES.md): playing it, then its
// leaderboard, competitions and posts. Tabs are a `?tab=` on the game's own page, so
// a new game gets them by rendering GameTabs and GameSection.

export const GAME_TABS = [
  ['play', 'Play'],
  ['leaderboard', 'Leaderboard'],
  ['competitions', 'Competitions'],
  ['posts', 'Posts'],
] as const

export type GameTab = (typeof GAME_TABS)[number][0]

/** The tab a `?tab=` names; Play for anything else. */
export const gameTab = (v: string | string[] | undefined): GameTab => GAME_TABS.find(([t]) => t === v)?.[0] ?? 'play'

export const gameTabHref = (slug: string, tab: GameTab) => (tab === 'play' ? `/games/${slug}` : `/games/${slug}?tab=${tab}`)

export function GameTabs({ slug, name, tab }: { slug: string; name: string; tab: GameTab }) {
  return (
    <nav className="feed-tabs game-tabs" aria-label={name}>
      {GAME_TABS.map(([t, label]) => (
        <Link key={t} href={gameTabHref(slug, t)} className="feed-tab" aria-current={tab === t ? 'page' : undefined} scroll={false}>
          {label}
        </Link>
      ))}
    </nav>
  )
}
