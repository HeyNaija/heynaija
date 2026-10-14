import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { JoinButton } from '@/app/ui/join-button'
import { Avatar } from '@/app/ui/avatar'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Communities' }

export default function CommunitiesPage() {
  return (
    <div>
      <h1 className="page-title">Communities</h1>
      <p className="mt-1 text-sm text-muted">
        Join the ones you care about. Their posts show up in your Following feed, and you can post
        in them.
      </p>
      <div className="mt-4">
        <Suspense fallback={<PostsSkeleton />}>
          <CommunityList />
        </Suspense>
      </div>
    </div>
  )
}

async function CommunityList() {
  const [communities, viewer] = await Promise.all([getCommunities(), getViewer()])
  const isMember = viewer.state === 'member'

  return (
    <ul className="divide-y divide-line">
      {communities.map((c) => (
        <li key={c.slug} className="flex items-start gap-3 px-1 py-4">
          <Avatar handle={c.name} size={48} />
          <div className="min-w-0 flex-1">
            <Link href={`/c/${c.slug}`} className="text-[15px] font-semibold hover:underline">
              {c.name}
            </Link>
            <p className="mt-1 text-sm leading-relaxed text-muted">{c.description}</p>
            <p className="mt-1 text-xs text-muted">
              {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
            </p>
          </div>
          {isMember ? <JoinButton slug={c.slug} joined={c.viewerIsMember} /> : null}
        </li>
      ))}
    </ul>
  )
}
