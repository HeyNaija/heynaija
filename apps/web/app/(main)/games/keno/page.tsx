import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getKenoPlay, getViewer, type KenoPlay as KenoPlayView } from '@/lib/api'
import { type GameInfo, GameSection } from '../_components/game-section'
import { gameTab, GameTabs } from '../_components/game-tabs'
import { KenoPlay } from './_components/keno-play'

export const metadata: Metadata = { title: 'Keno', robots: { index: false } }

const KENO: GameInfo = {
  slug: 'keno',
  name: 'Keno',
  noCompetitions: 'Site moderators run Keno competitions: score the most points within a set window. They show here.',
}

/** Keno, free to play (docs/games/GAMES.md, docs/adr/0028 phase 4). */
export default function KenoPage({ searchParams }: PageProps<'/games/keno'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Games</p>
        <h1 className="page-title">Keno</h1>
        <p className="page-description">
          Pick up to 10 numbers from 1 to 80. Every few minutes 20 numbers are drawn for everyone at once; the more of
          yours come up, the more points you score.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Keno searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Keno({ searchParams }: Pick<PageProps<'/games/keno'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const tab = gameTab(params.tab)
  const tabs = <GameTabs slug="keno" name="Keno" tab={tab} />
  if (tab !== 'play') {
    return (
      <>
        {tabs}
        <GameSection game={KENO} tab={tab} params={params} viewerId={viewer.me.id} />
      </>
    )
  }
  const play = await getKenoPlay()
  if (!play) notFound()
  return (
    <>
      {tabs}
      <KenoPlay initial={play} />
      <nav className="content-panel keno-links" aria-label="More Keno">
        <Link href="/games/keno/tickets" className="btn btn-secondary">Your tickets</Link>
        <Link href="/games/keno/rounds" className="btn btn-secondary">Past draws</Link>
      </nav>
      <section className="content-panel" aria-labelledby="keno-free">
        <h2 id="keno-free" className="section-title">No money, ever</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You get {play.tokens.daily} free tokens every day, at midnight Lagos time; one token plays one ticket in one
          draw, and tokens left over do not carry on to the next day. Tokens and points cannot be bought, sold, sent to
          anyone or swapped for anything. Points count for the leaderboards, and nothing else.
        </p>
      </section>
      <PayoutTable payouts={play.payouts} />
    </>
  )
}

function PayoutTable({ payouts }: { payouts: KenoPlayView['payouts'] }) {
  const rows = Object.entries(payouts.table).sort(([a], [b]) => Number(a) - Number(b))
  return (
    <section className="content-panel" aria-labelledby="keno-points">
      <h2 id="keno-points" className="section-title">How points work</h2>
      <p className="mt-2 text-sm text-muted">
        What a ticket scores depends on how many numbers you picked and how many of them were drawn. Matches not listed
        score nothing.
      </p>
      <div className="keno-table-wrap">
        <table className="keno-table">
          <thead>
            <tr>
              <th scope="col">Numbers picked</th>
              <th scope="col">Matched → points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([spots, pays]) => (
              <tr key={spots}>
                <th scope="row">{spots}</th>
                <td>
                  {Object.entries(pays)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([hits, points]) => `${hits} → ${Number(points).toLocaleString('en-NG')}`)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
