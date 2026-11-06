import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getModeration, getViewer } from '@/lib/api'
import { CompetitionForm } from '../_form'
import { lagosInput } from '../_bits'

export const metadata: Metadata = { title: 'New competition', robots: { index: false } }

/** A site moderator makes a competition (docs/adr/0018, phase 5). */
export default function NewCompetitionPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/competitions" className="hover:underline">Competitions</Link>
        </p>
        <h1 className="page-title">New competition</h1>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <NewCompetition />
      </Suspense>
    </div>
  )
}

async function NewCompetition() {
  const [viewer, moderation] = await Promise.all([getViewer(), getModeration()])
  // Site moderators only (they alone get the roster).
  if (viewer.state !== 'member' || !viewer.me.features.games || !moderation?.roster) notFound()
  const communities = (await getCommunities()).map((c) => ({ slug: c.slug, name: c.name }))
  // Tomorrow evening, Lagos time, for a week: a starting point to change.
  const day = 86_400_000
  const start = new Date(Math.ceil(Date.now() / day) * day + 17 * 3_600_000)
  return (
    <section className="content-panel">
      <CompetitionForm
        communities={communities}
        defaults={{
          name: '',
          eligibility: 'open',
          community: '',
          invite: '',
          entryOpensAt: lagosInput(new Date(Date.now() + 3_600_000)),
          entryClosesAt: lagosInput(new Date(start.getTime() + 6 * day)),
          startsAt: lagosInput(start),
          endsAt: lagosInput(new Date(start.getTime() + 7 * day)),
        }}
      />
    </section>
  )
}
