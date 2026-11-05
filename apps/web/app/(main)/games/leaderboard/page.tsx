import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { TrophyIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { type GameBoardFilter, type GameBoardKind, getCommunities, getGameBoard, getGameSeasons, getViewer } from '@/lib/api'
import { BOARD_NAMES, BoardRows, periodName } from '../_components/board'

export const metadata: Metadata = { title: 'Games leaderboards', robots: { index: false } }

/** Season and all-time standings for the Game Score and each game (docs/adr/0018, phase 5). */
export default function LeaderboardsPage({ searchParams }: PageProps<'/games/leaderboard'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games" className="hover:underline">Games</Link>
        </p>
        <h1 className="page-title">Leaderboards</h1>
        <p className="page-description">
          Seasons are calendar months, Lagos time. <Link href="/games/scoring" className="underline">How games scoring works</Link>
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Boards searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

async function Boards({ searchParams }: Pick<PageProps<'/games/leaderboard'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const board: GameBoardKind = one(params.board) === 'chess' ? 'chess' : one(params.board) === 'keno' ? 'keno' : 'score'
  const filter: GameBoardFilter = one(params.filter) === 'following' ? 'following' : one(params.filter) === 'community' ? 'community' : 'everyone'
  const [seasons, communities] = await Promise.all([getGameSeasons(), getCommunities()])
  if (!seasons) notFound()
  const joined = communities.filter((c) => c.viewerIsMember)
  const community = filter === 'community' ? (one(params.community) ?? joined[0]?.slug) : undefined
  const periodParam = one(params.period)
  const period = periodParam === 'all' || (periodParam && seasons.seasons.includes(periodParam)) ? periodParam : seasons.current
  const data = await getGameBoard({ board, period, filter, community })
  if (!data) notFound()
  const periods = [...new Set([seasons.current, ...seasons.seasons])]
  const link = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    const merged = { board, period, filter, community, ...over }
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'board' && v === 'score') && !(k === 'filter' && v === 'everyone') && !(k === 'period' && v === seasons.current)) q.set(k, v)
    if (merged.filter !== 'community') q.delete('community')
    const s = q.toString()
    return `/games/leaderboard${s ? `?${s}` : ''}`
  }
  return (
    <section className="content-panel" aria-labelledby="board-title">
      <nav className="feed-tabs keno-tabs" aria-label="Board">
        {(['score', 'chess', 'keno'] as const).map((b) => (
          <Link key={b} href={link({ board: b })} className="feed-tab" aria-current={board === b ? 'page' : undefined}>
            {BOARD_NAMES[b]}
          </Link>
        ))}
      </nav>
      <form method="get" action="/games/leaderboard" className="leaderboard-controls">
        {board !== 'score' ? <input type="hidden" name="board" value={board} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Season</span>
          <select name="period" className="field" defaultValue={period}>
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodName(p)}
                {p === seasons.current ? ' (now)' : ''}
              </option>
            ))}
            <option value="all">All time</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Who</span>
          <select name="filter" className="field" defaultValue={filter}>
            <option value="everyone">Everyone</option>
            <option value="following">People you follow</option>
            {joined.length ? <option value="community">A community you joined</option> : null}
          </select>
        </label>
        {filter === 'community' && joined.length ? (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Community</span>
            <select name="community" className="field" defaultValue={community}>
              {joined.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn btn-secondary self-end">Show</button>
      </form>
      <h2 id="board-title" className="mt-3 text-sm font-semibold">
        {BOARD_NAMES[board]} · {periodName(data.period)}
        {filter === 'following' ? ' · people you follow' : filter === 'community' && community ? ` · ${joined.find((c) => c.slug === community)?.name ?? community}` : ''}
      </h2>
      {data.rows.length ? (
        <BoardRows board={data} />
      ) : (
        <EmptyState icon={<TrophyIcon size={28} />} title="No standings yet">
          Nobody here has scored {data.period === 'all' ? 'yet' : 'this season yet'}. Play a game and the standings start with you.
        </EmptyState>
      )}
    </section>
  )
}
