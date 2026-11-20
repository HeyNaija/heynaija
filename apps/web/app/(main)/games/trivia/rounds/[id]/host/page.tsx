import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getTriviaHost, getViewer } from '@/lib/api'
import { HostConsole } from '../../../_components/host-console'
import { requireGames } from '../../../../_components/require-games'

export const metadata: Metadata = { title: 'Trivia console', robots: { index: false } }

/** The host runs their round from here (docs/adr/0028, phase 7). */
export default function TriviaHostPage({ params }: PageProps<'/games/trivia/rounds/[id]/host'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<PostsSkeleton />}>
        <Console params={params} />
      </Suspense>
    </div>
  )
}

async function Console({ params }: Pick<PageProps<'/games/trivia/rounds/[id]/host'>, 'params'>) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()])
  requireGames(viewer, `/games/trivia/rounds/${id}/host`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const round = await getTriviaHost(id)
  if (!round) notFound()
  return (
    <>
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/trivia" className="hover:underline">Trivia</Link> · Your console
        </p>
        <h1 className="page-title">{round.title}</h1>
      </header>
      <HostConsole key={round.id} initial={round} />
    </>
  )
}
