import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getCompetition, getViewer } from '@/lib/api'
import { lagosInput } from '../../_bits'
import { CompetitionForm } from '../../_form'

export const metadata: Metadata = { title: 'Change competition', robots: { index: false } }

/** A moderator changes a competition before entry opens (docs/adr/0028, phase 5). */
export default function EditCompetitionPage({ params }: PageProps<'/games/competitions/[id]/edit'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/games/competitions" className="hover:underline">Competitions</Link>
        </p>
        <h1 className="page-title">Change competition</h1>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Edit params={params} />
      </Suspense>
    </div>
  )
}

async function Edit({ params }: Pick<PageProps<'/games/competitions/[id]/edit'>, 'params'>) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()])
  if (viewer.state !== 'member' || !viewer.me.features.games || !/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const c = await getCompetition(id)
  if (!c?.you.moderator) notFound()
  const communities = (await getCommunities()).map((x) => ({ slug: x.slug, name: x.name }))
  return (
    <section className="content-panel">
      <CompetitionForm
        communities={communities}
        defaults={{
          id: c.id,
          name: c.name,
          eligibility: c.eligibility,
          community: c.community?.slug ?? '',
          invite: c.invite.map((h) => `@${h}`).join(' '),
          entryOpensAt: lagosInput(c.entryOpensAt),
          entryClosesAt: lagosInput(c.entryClosesAt),
          startsAt: lagosInput(c.startsAt),
          endsAt: lagosInput(c.endsAt),
        }}
      />
    </section>
  )
}
