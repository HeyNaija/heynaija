import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Composer } from '@/app/ui/composer'
import { JoinButton } from '@/app/ui/join-button'
import { Avatar } from '@/app/ui/avatar'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getCommunity, getCommunityPosts, getViewer } from '@/lib/api'

type Props = PageProps<'/c/[slug]'>

export default function CommunityPage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <CommunityView {...props} />
    </Suspense>
  )
}

async function CommunityView({ params, searchParams }: Props) {
  const [{ slug }, { cursor }] = await Promise.all([params, searchParams])
  const page = typeof cursor === 'string' ? cursor : undefined

  const [community, viewer] = await Promise.all([getCommunity(slug), getViewer()])
  if (!community) notFound()
  const feed = await getCommunityPosts(community.slug, page)
  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  const rules = community.rules.split('\n').filter((line) => line.trim())

  return (
    <div className="flex flex-col gap-3">
      {/* Rendered here rather than via metadata: the name is only known after the fetch. */}
      <title>{`${community.name} · HeyNaija`}</title>

      <header className="page-header">
        <div className="flex items-start gap-4">
          <Avatar handle={community.name} size={56} />
          <div className="min-w-0 flex-1">
            <Link href="/c" className="text-xs font-medium text-muted hover:text-ink hover:underline">
              Communities
            </Link>
            <h1 className="page-title mt-1">{community.name}</h1>
          </div>
          {viewerId ? <JoinButton slug={community.slug} joined={community.viewerIsMember} /> : null}
        </div>
        <p className="mt-2 text-sm text-muted">{community.description}</p>
        <p className="mt-2 text-sm text-muted">
          <span className="font-semibold text-ink">{community.memberCount}</span>{' '}
          {community.memberCount === 1 ? 'member' : 'members'}
          {community.moderators.length ? (
            <>
              {' · Moderated by '}
              {community.moderators.map((handle, i) => (
                <span key={handle}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/u/${handle}`} className="text-ink hover:underline">
                    @{handle}
                  </Link>
                </span>
              ))}
            </>
          ) : null}
        </p>

        {rules.length ? (
          <details className="mt-4 rounded-lg bg-panel px-4 py-3 text-sm">
            <summary className="font-semibold">Community rules</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </header>

      {viewer.state === 'member' && community.viewerIsMember ? (
        <Composer
          handle={viewer.me.handle}
          community={community.slug}
          placeholder={`Say something to ${community.name}`}
        />
      ) : viewerId ? (
        <p className="notice">Join this community to post in it.</p>
      ) : (
        <p className="notice">
          <Link href="/login" className="font-semibold underline underline-offset-2">
            Sign in
          </Link>{' '}
          to join and post.
        </p>
      )}

      <section aria-label={`Posts in ${community.name}`}>
        <PostList
          posts={feed.posts}
          viewerId={viewerId}
          now={Date.now()}
          hideCommunity
          empty={page ? { title: 'No older posts' } : { title: 'No posts here yet', detail: 'Start the conversation.' }}
          olderHref={feed.cursor ? `/c/${community.slug}?cursor=${encodeURIComponent(feed.cursor)}` : null}
        />
      </section>
    </div>
  )
}
