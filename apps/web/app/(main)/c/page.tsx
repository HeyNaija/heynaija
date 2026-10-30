import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { JoinButton } from '@/app/ui/join-button'
import { CommunityMark } from '@/app/ui/community-mark'
import { EmptyState } from '@/app/ui/empty-state'
import { ArrowUpRightIcon, PeopleIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { TopicsLink } from '@/app/ui/topics-link'
import { getCommunities, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Communities' }

export default function CommunitiesPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Find your people</p>
        <h1 className="page-title">Communities</h1>
        <p className="page-description">
          Join a community to post in it and bring its conversations into your Following feed. Looking for a subject
          instead? See the{' '}
          <TopicsLink className="font-semibold text-accent-strong hover:underline">trending topics</TopicsLink>
          .
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <CommunityList />
      </Suspense>
    </div>
  )
}

async function CommunityList() {
  const [communities, viewer] = await Promise.all([getCommunities(), getViewer()])
  const isMember = viewer.state === 'member'

  if (!communities.length) {
    return (
      <div className="content-panel">
        <EmptyState icon={<PeopleIcon size={24} />} title="Communities are on their way">
          Check back soon for places to join the conversation.
        </EmptyState>
      </div>
    )
  }

  return (
    <ul className="directory-grid" aria-label="All communities">
      {communities.map((c) => (
        <li key={c.slug} className="community-card">
          <div className="flex items-start gap-3">
            <CommunityMark slug={c.slug} large />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">
                <Link href={`/c/${c.slug}`} className="hover:underline">{c.name}</Link>
              </h2>
              <p className="mt-1 text-xs text-muted">
                {c.memberCount.toLocaleString('en-NG')} {c.memberCount === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
          <p className="flex-1 text-sm leading-relaxed text-muted">{c.description}</p>
          <div className="community-card-footer">
            <Link href={`/c/${c.slug}`} aria-label={`Explore ${c.name}`} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-accent-strong hover:underline">
              Explore community <ArrowUpRightIcon size={16} />
            </Link>
            {isMember ? <JoinButton slug={c.slug} joined={c.viewerIsMember} compact /> : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
