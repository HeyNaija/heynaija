import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getTriviaList, getViewer } from '@/lib/api'
import { lagosInput } from '../../competitions/_bits'
import { RoundForm } from '../_components/round-form'
import { blankQuestion } from '../_components/round-draft'

export const metadata: Metadata = { title: 'Host a trivia round', robots: { index: false } }

/** A site moderator who is an adult writes a new round (docs/adr/0028, phase 7). */
export default function HostTriviaPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/trivia" className="hover:underline">Trivia</Link>
        </p>
        <h1 className="page-title">Host a round</h1>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <NewRound />
      </Suspense>
    </div>
  )
}

async function NewRound() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  const list = await getTriviaList()
  if (!list?.mayHost) notFound()
  // Game Night is the default; Chess Arena is chess's own.
  const communities = (await getCommunities()).filter((c) => c.slug !== 'game-night' && c.slug !== 'chess-arena').map((c) => ({ slug: c.slug, name: c.name }))
  // Tomorrow at 8 pm, Lagos time: a starting point to change.
  const day = 86_400_000
  const start = new Date(Math.ceil(Date.now() / day) * day + 19 * 3_600_000)
  return (
    <section className="content-panel">
      <RoundForm
        communities={communities}
        defaults={{ title: '', community: '', startsAt: lagosInput(start), secondsPerQuestion: 20, autoAdvance: false, questions: [blankQuestion('choice')] }}
      />
    </section>
  )
}
