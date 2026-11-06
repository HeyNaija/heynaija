import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCommunityPosts, getCompetitions, getGameBoard, getGames, getViewer } from '@/lib/api'
import { GameCard } from './_components/game-card'
import { CompetitionStrip, LeaderboardPreview, RecentGamePosts, ScoreCard } from './_components/home-sections'

// Dark while Games is being built (docs/adr/0018): proxy.ts answers 404 for anyone
// not on the list, so this is not indexed either.
export const metadata: Metadata = { title: 'Games', robots: { index: false } }

/** The games homepage (docs/games/GAMES.md): your score, the games, the season and what is on. */
export default function GamesPage({ searchParams }: PageProps<'/games'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Games</p>
        <h1 className="page-title">Games</h1>
        <p className="page-description">
          Play with other members, climb the season leaderboards and take part in competitions. Free to play: nothing here
          costs money or pays out.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <GamesHome searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function GamesHome({ searchParams }: Pick<PageProps<'/games'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  // With Games off, or for anyone not on its list (or signed out), this page does not exist.
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const board = params.board === 'chess' ? 'chess' : params.board === 'keno' ? 'keno' : 'score'
  const [registry, season, allTime, preview, competitions, night, arena] = await Promise.all([
    getGames(),
    getGameBoard({ board: 'score', limit: 1 }),
    getGameBoard({ board: 'score', period: 'all', limit: 1 }),
    getGameBoard({ board, limit: 5 }),
    getCompetitions(),
    getCommunityPosts('game-night').catch(() => null),
    getCommunityPosts('chess-arena').catch(() => null),
  ])
  if (!registry) notFound()
  // The Arbiter's latest: competition results and game threads, newest first.
  const posts = [...(night?.posts ?? []), ...(arena?.posts ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 3)
  return (
    <>
      <ScoreCard season={season} allTime={allTime} />
      <section aria-labelledby="games-list">
        <h2 id="games-list" className="sr-only">All games</h2>
        <ul className="directory-grid">
          {registry.games.map((game) => (
            <GameCard key={game.slug} game={game} />
          ))}
        </ul>
      </section>
      <LeaderboardPreview board={preview} />
      <CompetitionStrip items={competitions?.current ?? []} />
      <RecentGamePosts posts={posts} viewerId={viewer.me.id} now={Date.now()} />
    </>
  )
}
