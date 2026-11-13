import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getViewer } from '@/lib/api'
import { BoardView } from '../_components/board-view'

export const metadata: Metadata = { title: 'Game Score leaderboard', robots: { index: false } }

/** Season and all-time Game Score standings, all games together (docs/adr/0028, phase 5). Each game's own board is its page's Leaderboard tab. */
export default function LeaderboardsPage({ searchParams }: PageProps<'/games/leaderboard'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games" className="hover:underline">Games</Link>
        </p>
        <h1 className="page-title">Game Score leaderboard</h1>
        <p className="page-description">
          XP from every game together. Seasons are calendar months, Lagos time.{' '}
          <Link href="/games/scoring" className="underline">How games scoring works</Link>
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Boards searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Boards({ searchParams }: Pick<PageProps<'/games/leaderboard'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  // Old links to a game's board go to that game's Leaderboard tab, with the same choices.
  const { board, ...rest } = params
  if (board === 'chess' || board === 'keno') {
    const q = new URLSearchParams({ tab: 'leaderboard' })
    for (const [k, v] of Object.entries(rest)) if (typeof v === 'string') q.set(k, v)
    redirect(`/games/${board}?${q}`)
  }
  return <BoardView board="score" params={params} path="/games/leaderboard" />
}
