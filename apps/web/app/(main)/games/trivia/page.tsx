import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { TriviaIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getGameScoring, getTriviaList, getViewer } from '@/lib/api'
import { type GameInfo, GameSection } from '../_components/game-section'
import { gameTab, GameTabs } from '../_components/game-tabs'
import { RoundSection } from './_components/bits'

export const metadata: Metadata = { title: 'Trivia', robots: { index: false } }

const TRIVIA: GameInfo = {
  slug: 'trivia',
  name: 'Trivia',
  // Rounds are posted in Game Night (or a round's own community).
  community: { slug: 'game-night', name: 'Game Night' },
  noCompetitions: 'Trivia is not in competitions: every round already has its own results. Rounds are on the Play tab.',
}

/** Trivia: hosted live rounds (docs/games/GAMES.md, docs/adr/0028 phase 7). */
export default function TriviaPage({ searchParams }: PageProps<'/games/trivia'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games" className="hover:underline">Games</Link>
        </p>
        <h1 className="page-title">Trivia</h1>
        <p className="page-description">
          Live quiz rounds, run by a host. Each question appears on everyone’s screen at the same moment; the fastest right
          answers score most.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Trivia searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Trivia({ searchParams }: Pick<PageProps<'/games/trivia'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const tab = gameTab(params.tab)
  const tabs = <GameTabs slug="trivia" name="Trivia" tab={tab} />
  if (tab !== 'play') {
    return (
      <>
        {tabs}
        <GameSection game={TRIVIA} tab={tab} params={params} viewerId={viewer.me.id} />
      </>
    )
  }
  const [list, scoring] = await Promise.all([getTriviaList(), getGameScoring()])
  if (!list) notFound()
  const points = scoring?.trivia ?? { right: 10, order: [5, 3, 2] }
  const nothing = !list.live.length && !list.upcoming.length && !list.recent.length
  return (
    <>
      {tabs}
      {list.mayHost ? (
        <nav className="content-panel keno-links" aria-label="Hosting">
          <Link href="/games/trivia/host" className="btn btn-primary">Host a round</Link>
        </nav>
      ) : null}
      {list.hosting.length ? <RoundSection title="Your rounds" items={list.hosting} hosting /> : null}
      {list.live.length ? <RoundSection title="Live now" items={list.live} /> : null}
      {list.upcoming.length ? <RoundSection title="Coming up" items={list.upcoming} /> : null}
      {nothing ? (
        <section className="content-panel">
          <EmptyState icon={<TriviaIcon size={28} />} title="No rounds yet">
            When a host schedules a round, it shows here and The Arbiter posts it in Game Night. Open it a little before it
            starts.
          </EmptyState>
        </section>
      ) : null}
      {list.recent.length ? <RoundSection title="Recent results" items={list.recent} /> : null}
      <section className="content-panel" aria-labelledby="trivia-points">
        <h2 id="trivia-points" className="section-title">How points work</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
          <li>
            A right answer scores {points.right} points. The first three right answers score {points.order.map((n) => `${n}`).join(', ')}{' '}
            more, decided by HeyNaija’s server as each answer arrives, not by your phone’s clock.
          </li>
          <li>
            On a question with choices you can change your choice until time is up: the last one counts, at the time you made it. A typed
            answer cannot be changed. Answers stay hidden until time is up.
          </li>
          <li>Typed answers ignore capitals, accents and punctuation, and forgive a small typo in a longer answer.</li>
          <li>The round’s winner has the most points; on equal points, whoever spent less time on their right answers.</li>
          <li>
            Points count for the Trivia leaderboard and your Game Score, and nothing else. No prizes.{' '}
            <Link href="/games/scoring" className="underline">How games scoring works</Link>
          </li>
        </ul>
      </section>
    </>
  )
}
