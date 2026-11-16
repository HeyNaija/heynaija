import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getTriviaRound, getViewer } from '@/lib/api'
import { TriviaRound } from '../../_components/trivia-round'

export const metadata: Metadata = { title: 'Trivia round', robots: { index: false } }

/** A Trivia round, live or over (docs/adr/0028, phase 7). */
export default function TriviaRoundPage({ params }: PageProps<'/games/trivia/rounds/[id]'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<PostsSkeleton />}>
        <RoundPage params={params} />
      </Suspense>
    </div>
  )
}

async function RoundPage({ params }: Pick<PageProps<'/games/trivia/rounds/[id]'>, 'params'>) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games) notFound()
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const round = await getTriviaRound(id)
  if (!round) notFound()
  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/trivia" className="hover:underline">Trivia</Link>
        </p>
        <h1 className="page-title">{round.title}</h1>
      </header>
      <TriviaRound key={round.id} initial={round} />
    </>
  )
}
