import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { TrophyIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCompetitions, getViewer } from '@/lib/api'
import { CompetitionSection } from './_bits'

export const metadata: Metadata = { title: 'Competitions', robots: { index: false } }

/** Games competitions (docs/adr/0028, phase 5): what is on, coming up and recently finished. */
export default function CompetitionsPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games" className="hover:underline">Games</Link>
        </p>
        <h1 className="page-title">Competitions</h1>
        <p className="page-description">
          Play inside a set window and see where you finish. Places earn Game Score XP; The Arbiter posts the results in Game
          Night. Free to play, with nothing to win but the standings.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Competitions />
      </Suspense>
    </div>
  )
}

async function Competitions() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const list = await getCompetitions()
  if (!list) notFound()
  return (
    <>
      {list.drafts.length ? <CompetitionSection title="Drafts (moderators only)" items={list.drafts} /> : null}
      {list.current.length ? (
        <CompetitionSection title="Live and coming up" items={list.current} />
      ) : (
        <section className="content-panel">
          <EmptyState icon={<TrophyIcon size={28} />} title="No competitions yet">
            Upcoming and live competitions will be listed here.
          </EmptyState>
        </section>
      )}
      {list.recent.length ? <CompetitionSection title="Recently finished" items={list.recent} /> : null}
      <p className="px-1 text-sm">
        <Link href="/games/scoring" className="underline">How games scoring works</Link>
      </p>
    </>
  )
}
