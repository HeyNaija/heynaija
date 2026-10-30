import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppPushCard } from '@/app/ui/app-push-card'
import { AppealForm } from '@/app/ui/appeal-form'
import { Composer } from '@/app/ui/composer'
import { DiscoverMoment } from '@/app/ui/discover-moment'
import { FeedTab } from '@/app/ui/feed-tab'
import { ArrowUpRightIcon, PeopleIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { card, PostList, PostsSkeleton } from '@/app/ui/post-item'
import { StartGist } from '@/app/ui/gists/start-gist'
import {
  type Feed,
  getCommunities,
  getDiscoverFeed,
  getFeed,
  getFollowingFeed,
  getLatestAppeal,
  getPushKey,
  getViewer,
} from '@/lib/api'
import { discoverPeriod } from '@/lib/discover'
import { FEED_COOKIE, type HomeFeed, homeFeed } from '@/lib/home-feed'

export default function HomePage({ searchParams }: PageProps<'/'>) {
  // Everything that depends on the visitor streams in; the shell renders at once.
  // The heading and tabs only need to know who is looking, so they stream in on
  // their own and do not wait for the posts; only the posts get a skeleton.
  return (
    <div className="home-feed">
      <Suspense fallback={<HeaderSpace />}>
        <HomeHeader searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<PostsSkeleton />}>
        <HomeFeed searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined)

/** Who is looking, and which feed they asked for: all the heading and tabs depend on. */
async function whoIsLooking({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const params = await searchParams
  const remembered = (await cookies()).get(FEED_COOKIE)?.value
  const viewer = await getViewer()
  const me = viewer.state === 'member' ? viewer.me : null
  // Newcomers go through the welcome flow first, until they finish or skip it.
  if (me && !me.onboarded) redirect('/welcome')
  return {
    params,
    viewer,
    me,
    // The feed in the address, else the tab last chosen, else Discover. Following is for members.
    feed: homeFeed(one(params.feed), remembered, !!me),
    // Its last step: having joined and followed, a nudge to say hello.
    welcomed: !!me && one(params.welcome) === '1',
  }
}

/**
 * The heading and, for a member, the Discover, Latest and Following tabs. It sits there while
 * the page loads, invisible, so that a member's page does not jump when the real
 * thing arrives and no placeholder is drawn where text will be. (A visitor's welcome
 * is taller; theirs is the one page that does shift.)
 */
function HeaderSpace() {
  return (
    <div className="home-feed invisible" aria-hidden="true" inert>
      <MemberHeader feed="discover" />
    </div>
  )
}

function MemberHeader({ feed }: { feed: HomeFeed }) {
  return (
    <>
      <header className="home-intro">
        <p className="page-eyebrow">Made for us</p>
        <h1 className="page-title">Your town square<span className="text-accent">.</span></h1>
        <p className="page-description">A little closer to home. One conversation at a time.</p>
      </header>
      <FeedTabs feed={feed} member />
    </>
  )
}

/** Discover first, then Latest, and Following for members; beside them, how the one shown is ordered. */
function FeedTabs({ feed, member = false }: { feed: HomeFeed; member?: boolean }) {
  return (
    <nav aria-label="Feeds" className="feed-tabs">
      <FeedTab feed="discover" active={feed === 'discover'}>
        Discover
      </FeedTab>
      <FeedTab feed="latest" active={feed === 'latest'}>
        Latest
      </FeedTab>
      {member ? (
        <FeedTab feed="following" active={feed === 'following'}>
          Following
        </FeedTab>
      ) : null}
      {feed === 'discover' ? (
        <Link href="/about/discover" className="feed-order hover:underline"><span aria-hidden="true" /> Ranked by published rules</Link>
      ) : (
        <span className="feed-order"><span aria-hidden="true" /> Newest first, not ranked</span>
      )}
    </nav>
  )
}

async function HomeHeader({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { viewer, me, feed, welcomed } = await whoIsLooking({ searchParams })

  if (me) {
    return (
      <>
        <MemberHeader feed={feed} />
        {welcomed ? (
          <section className="welcome-nudge" aria-labelledby="welcome-nudge-title">
            <p className="page-eyebrow">You are in</p>
            <h2 id="welcome-nudge-title" className="section-title">Say hello to the town square</h2>
            <p className="field-hint">
              Write a first post to introduce yourself. It is how people here find you, and follow you back.
            </p>
            <Link href={`/?feed=${feed}`} className="welcome-back self-start">Not now</Link>
          </section>
        ) : null}
        <Suspense fallback={null}>
          <AppPush />
        </Suspense>
      </>
    )
  }

  if (viewer.state === 'blocked') {
    return viewer.suspended ? (
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
  }

  return (
    <>
      <header className="home-intro welcome-intro">
        <p className="page-eyebrow">At home. And everywhere.</p>
        <h1>Good people.<br />Great conversations<span className="text-accent">.</span></h1>
        <p className="page-description">Your corner of the internet. Connect with Nigerians, find your community, and feel a little closer to home.</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href="/join" className="btn btn-primary">Join the conversation <ArrowUpRightIcon size={17} /></Link>
          <Link href="/login" className="btn btn-secondary">Sign in</Link>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Growing together. Invite-only for now.{' '}
          <Link href="/about" className="font-semibold text-accent-strong hover:underline">About HeyNaija</Link>
        </p>
      </header>
      <FeedTabs feed={feed} />
    </>
  )
}

/**
 * In HeyNaija opened as an installed app, the offer of push notifications. It
 * fetches the key on its own, so the heading does not wait for it.
 */
async function AppPush() {
  const publicKey = await getPushKey()
  return publicKey ? <AppPushCard publicKey={publicKey} /> : null
}

async function HomeFeed({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { params, me, feed: asked, welcomed } = await whoIsLooking({ searchParams })
  const cursor = one(params.cursor)

  // If Discover or the Following feed cannot be had, Latest stands in for it.
  const discovered = asked === 'discover' ? await getDiscoverFeed(cursor, one(params.at)) : null
  const chosen: Feed | null = asked === 'following' ? await getFollowingFeed(cursor) : discovered
  const shown: HomeFeed = chosen ? asked : 'latest'
  const [feed, communities] = await Promise.all([chosen ?? getFeed(cursor), me ? getCommunities() : []])
  const joined = communities.filter((c) => c.viewerIsMember)
  const period = discovered ? discoverPeriod(discovered.rules.windowHours) : ''

  return (
    <>
      {me?.features.gists ? <StartGist /> : null}
      {me ? (
        <Composer
          handle={me.handle}
          avatar={me.avatar}
          choices={joined}
          polls={me.features.polls}
          replyControls={me.features.replyControls}
          placeholder={welcomed ? 'Introduce yourself: who are you, and what brings you here?' : undefined}
        />
      ) : null}

      {me && joined.length === 0 ? <Link href="/c" className="community-discovery"><span className="community-mark"><PeopleIcon size={19} /></span><span><strong>Find a place that feels like you</strong><span>Explore communities and join the conversation.</span></span><ArrowUpRightIcon size={18} /></Link> : null}

      {discovered && !cursor ? <DiscoverMoment at={discovered.asOf} /> : null}

      <section
        aria-label={
          shown === 'following'
            ? 'Posts from people and communities you follow'
            : shown === 'discover'
              ? 'Discover: recent posts ranked by published rules'
              : 'Latest posts'
        }
      >
        <PostList
          posts={feed.posts}
          viewerId={me?.id ?? null}
          now={Date.now()}
          explain
          end={
            shown === 'discover' ? (
              <>
                That&apos;s Discover for the last {period}.{' '}
                <Link href="/?feed=latest" className="font-semibold text-accent-strong hover:underline">Latest</Link> has every post,
                newest first.
              </>
            ) : undefined
          }
          empty={
            shown === 'discover'
              ? {
                  title: cursor ? 'That is everything in Discover' : 'Nothing in Discover yet',
                  detail: `Discover shows posts from the last ${period} that people are replying to, liking and sharing, and posts from the people and communities you follow. Latest has every post, newest first.`,
                  action: (
                    <Link href="/?feed=latest" className="btn btn-secondary">
                      Read Latest
                    </Link>
                  ),
                }
              : cursor
                ? { title: 'No older posts' }
                : shown === 'following'
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
          more={{ source: { kind: shown }, cursor: feed.cursor }}
        />
      </section>
    </>
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
          {appeal.resolvedAt ? <> on <LocalTime at={appeal.resolvedAt} as="dayMonth" /></> : null}{' '}
          and kept the suspension. You can appeal again if there is something they should know.
        </p>
      ) : null}
      <AppealForm />
    </>
  )
}
