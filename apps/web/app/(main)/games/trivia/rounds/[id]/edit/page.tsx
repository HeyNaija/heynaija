import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getTriviaHost, getViewer } from '@/lib/api'
import { lagosInput } from '../../../../competitions/_bits'
import { RoundForm } from '../../../_components/round-form'
import { requireGames } from '../../../../_components/require-games'

export const metadata: Metadata = { title: 'Edit trivia round', robots: { index: false } }

/** Changes a round until its first question opens (docs/adr/0028, phase 7). */
export default function EditTriviaPage({ params }: PageProps<'/games/trivia/rounds/[id]/edit'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/trivia" className="hover:underline">Trivia</Link>
        </p>
        <h1 className="page-title">Edit round</h1>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <EditRound params={params} />
      </Suspense>
    </div>
  )
}

async function EditRound({ params }: Pick<PageProps<'/games/trivia/rounds/[id]/edit'>, 'params'>) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()])
  requireGames(viewer, `/games/trivia/rounds/${id}/edit`)
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const round = await getTriviaHost(id)
  if (!round) notFound()
  const editable = (round.status === 'draft' || round.status === 'scheduled') && round.questions.every((q) => !q.opensAt)
  if (!editable) {
    return (
      <section className="content-panel text-sm">
        This round can no longer change: a question has opened.{' '}
        <Link href={`/games/trivia/rounds/${id}/host`} className="underline">Back to your console</Link>
      </section>
    )
  }
  // Game Night is the default; Chess Arena is chess's own.
  const communities = (await getCommunities()).filter((c) => c.slug !== 'game-night' && c.slug !== 'chess-arena').map((c) => ({ slug: c.slug, name: c.name }))
  return (
    <section className="content-panel">
      <RoundForm
        // A new version (a save here, or another host's) starts the form again from it.
        key={`${round.id}:${round.version}`}
        communities={communities}
        defaults={{
          id: round.id,
          title: round.title,
          community: round.community?.slug ?? '',
          startsAt: lagosInput(round.startsAt),
          scheduled: round.status === 'scheduled',
          secondsPerQuestion: round.secondsPerQuestion,
          autoAdvance: round.autoAdvance,
          questions: round.questions.map((q) => ({
            kind: q.kind,
            prompt: q.prompt,
            choices: [...(q.choices ?? []), '', '', '', ''].slice(0, 4),
            correctChoice: q.correctChoice ?? 0,
            accepted: (q.accepted ?? []).join('\n'),
            explanation: q.explanation ?? '',
            image: q.image ? { mediaId: q.image.id, preview: `${q.image.src}/640.webp`, status: 'ready', error: null, alt: q.image.alt } : null,
          })),
        }}
      />
    </section>
  )
}
