import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { EmptyState } from '@/app/ui/empty-state'
import { TrophyIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getKenoBoard, getViewer, type KenoBoardRow } from '@/lib/api'

export const metadata: Metadata = { title: 'Keno leaderboard', robots: { index: false } }

const MONTH = new Intl.DateTimeFormat('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthName = (slug: string) => MONTH.format(new Date(`${slug}-15T00:00:00Z`))

/** Keno standings (docs/adr/0018, phase 4): this Lagos month, or all time. */
export default function KenoLeaderboardPage({ searchParams }: PageProps<'/games/keno/leaderboard'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/keno" className="hover:underline">Keno</Link>
        </p>
        <h1 className="page-title">Leaderboard</h1>
        <p className="page-description">Points from Keno tickets. Free to play: points are only for the standings.</p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Board searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Board({ searchParams }: Pick<PageProps<'/games/keno/leaderboard'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const period = params.period === 'all' ? 'all' : 'month'
  const board = await getKenoBoard(period)
  if (!board) notFound()
  const youShown = board.rows.some((r) => r.you)
  return (
    <section className="content-panel" aria-labelledby="keno-board">
      <h2 id="keno-board" className="sr-only">{period === 'all' ? 'All time' : `This month`}</h2>
      <nav className="feed-tabs keno-tabs" aria-label="Period">
        <Link href="/games/keno/leaderboard" className="feed-tab" aria-current={period === 'month' ? 'page' : undefined}>
          {board.season && period === 'month' ? monthName(board.season) : 'This month'}
        </Link>
        <Link href="/games/keno/leaderboard?period=all" className="feed-tab" aria-current={period === 'all' ? 'page' : undefined}>
          All time
        </Link>
      </nav>
      {board.rows.length ? (
        <ol className="keno-board">
          {board.rows.map((r) => (
            <BoardLine key={r.handle} row={r} />
          ))}
          {board.you && !youShown ? (
            <>
              <li className="keno-board-gap" aria-hidden="true">…</li>
              <BoardLine row={board.you} />
            </>
          ) : null}
        </ol>
      ) : (
        <EmptyState icon={<TrophyIcon size={28} />} title="No points yet">
          {period === 'month' ? 'Nobody has scored this month yet. ' : ''}Play a ticket and the standings start with you.
        </EmptyState>
      )}
    </section>
  )
}

function BoardLine({ row }: { row: KenoBoardRow }) {
  return (
    <li className="keno-board-row" data-you={row.you || undefined}>
      <span className="keno-rank">{row.rank}</span>
      <Link href={`/u/${row.handle}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
        <Avatar handle={row.handle} src={row.avatar} size={28} />
        <span className="truncate">
          {row.displayName ?? `@${row.handle}`}
          {row.you ? <span className="text-muted"> (you)</span> : null}
        </span>
      </Link>
      <span className="keno-points">{row.points.toLocaleString('en-NG')}</span>
    </li>
  )
}
