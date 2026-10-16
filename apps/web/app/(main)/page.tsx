import Link from 'next/link'
import { Suspense } from 'react'
import { AppealForm } from '@/app/ui/appeal-form'
import { Composer } from '@/app/ui/composer'
import { ArrowUpRightIcon, PeopleIcon } from '@/app/ui/icons'
import { card, PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getCommunities, getFeed, getFollowingFeed, getLatestAppeal, getViewer } from '@/lib/api'

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

  return (
    <div className="home-feed">
      {me ? (
        <>
          <header className="home-intro">
            <p className="page-eyebrow">Made for us</p>
            <h1 className="page-title">Your town square<span className="text-accent">.</span></h1>
            <p className="page-description">A little closer to home. One conversation at a time.</p>
          </header>
          <nav aria-label="Feeds" className="feed-tabs">
            <Tab href="/" active={!following}>
              Latest
            </Tab>
            <Tab href="/?feed=following" active={!!following}>
              Following
            </Tab>
            <span className="feed-order"><span aria-hidden="true" /> Newest first, not ranked</span>
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
            <AppealStatus />
          </div>
        ) : (
          <p className="notice">
            This account was not created with an invite, so it cannot post. Sign out and join with
            an invite code.
          </p>
        )
      ) : (
        <>
          <header className="home-intro welcome-intro">
            <p className="page-eyebrow">At home. And everywhere.</p>
            <h1>Good people.<br />Great conversations<span className="text-accent">.</span></h1>
            <p className="page-description">Your corner of the internet. Connect with Nigerians, find your community, and feel a little closer to home.</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link href="/join" className="btn btn-primary">Join the conversation <ArrowUpRightIcon size={17} /></Link>
              <Link href="/login" className="btn btn-secondary">Sign in</Link>
            </div>
            <p className="mt-3 text-xs text-muted">Growing together. Invite-only for now.</p>
          </header>
          <div className="feed-section-heading"><h2 className="section-title">From the town square</h2><span className="feed-order"><span aria-hidden="true" /> Newest first, not ranked</span></div>
        </>
      )}

      {me && joined.length === 0 ? <Link href="/c" className="community-discovery"><span className="community-mark"><PeopleIcon size={19} /></span><span><strong>Find a place that feels like you</strong><span>Explore communities and join the conversation.</span></span><ArrowUpRightIcon size={18} /></Link> : null}

      <section aria-label={following ? 'Posts from people and communities you follow' : 'Latest posts'}>
        <PostList
          posts={feed.posts}
          viewerId={me?.id ?? null}
          now={Date.now()}
          explain
          empty={
            cursor
              ? { title: 'No older posts' }
              : following
                ? {
                    title: 'Your Following feed is empty',
                    detail: 'Follow a few people or join a community, and their posts and reposts will show up here.',
                    action: (
                      <Link href="/c" className="btn btn-secondary">
                        Browse communities
                      </Link>
                    ),
                  }
                : { title: 'No posts yet', detail: 'Be the first to say something.' }
          }
          more={{ source: { kind: following ? 'following' : 'latest' }, cursor: feed.cursor }}
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

/** Where a suspended member's appeal stands, and the form when they can send one. */
async function AppealStatus() {
  const appeal = await getLatestAppeal()
  if (appeal?.status === 'open') {
    return (
      <p role="status" className="notice mt-4">
        Your appeal is waiting for a moderator. You will be able to use your account again if it is accepted.
      </p>
    )
  }
  return (
    <>
      {appeal?.status === 'dismissed' ? (
        <p className="notice mt-4">
          A moderator reviewed your appeal
          {appeal.resolvedAt
            ? ` on ${new Date(appeal.resolvedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long' })}`
            : ''}{' '}
          and kept the suspension. You can appeal again if there is something they should know.
        </p>
      ) : null}
      <AppealForm />
    </>
  )
}
