import Link from 'next/link'
import { Suspense } from 'react'
import { AppealForm } from '@/app/ui/appeal-form'
import { Composer } from '@/app/ui/composer'
import { card, PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getFeed, getFollowingFeed, getViewer } from '@/lib/api'

export default function HomePage({ searchParams }: PageProps<'/'>) {
  // Everything that depends on the visitor streams in; the shell renders at once.
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <Home searchParams={searchParams} />
    </Suspense>
  )
}

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined)

async function Home({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const params = await searchParams
  const cursor = one(params.cursor)
  const viewer = await getViewer()
  const me = viewer.state === 'member' ? viewer.me : null

  // "Following" only exists for members; anyone else gets the public feed.
  const following = me && one(params.feed) === 'following' ? await getFollowingFeed(cursor) : null
  const [feed, communities] = await Promise.all([following ?? getFeed(cursor), me ? getCommunities() : []])
  const joined = communities.filter((c) => c.viewerIsMember)
  const base = following ? '/?feed=following&' : '/?'

  return (
    <div className="flex flex-col gap-3">
      {me ? (
        <>
          <nav aria-label="Feeds" className="feed-tabs flex items-center gap-6 border-b border-line">
            <Tab href="/" active={!following}>
              For you
            </Tab>
            <Tab href="/?feed=following" active={!!following}>
              Following
            </Tab>
            <span className="ml-auto text-xs text-muted" title="Posts are shown newest first, not ranked by an algorithm">
              Latest first
            </span>
          </nav>
          <Composer handle={me.handle} avatar={me.avatar} choices={joined} />
        </>
      ) : viewer.state === 'blocked' ? (
        viewer.suspended ? (
          <div className={`${card} p-5`}>
            <h1 className="page-title">Your account is suspended</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              A moderator suspended this account, so you cannot post or interact for now. If you
              think that was a mistake, tell us why and a moderator will look again.
            </p>
            <AppealForm />
          </div>
        ) : (
          <p className="notice">
            This account was not created with an invite, so it cannot post. Sign out and join with
            an invite code.
          </p>
        )
      ) : (
        <div className={`${card} flex flex-wrap items-center justify-between gap-4 p-5`}>
          <div className="min-w-0">
            <h1 className="page-title">Real people. Real conversations.</h1>
            <p className="mt-1 text-sm text-muted">
              A social network for Nigerians at home and abroad. Invite-only for now.
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            <Link href="/login" className="btn btn-secondary">
              Sign in
            </Link>
            <Link href="/join" className="btn btn-primary">
              Join
            </Link>
          </span>
        </div>
      )}

      <section aria-label={following ? 'Posts from people and communities you follow' : 'Latest posts'}>
        <PostList
          posts={feed.posts}
          viewerId={me?.id ?? null}
          now={Date.now()}
          empty={
            cursor
              ? { title: 'No older posts' }
              : following
                ? {
                    title: 'Your Following feed is empty',
                    detail: 'Follow a few people or join a community, and their posts will show up here.',
                  }
                : { title: 'No posts yet', detail: 'Be the first to say something.' }
          }
          olderHref={feed.cursor ? `${base}cursor=${encodeURIComponent(feed.cursor)}` : null}
        />
      </section>
    </div>
  )
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className="feed-tab">
      {children}
    </Link>
  )
}
