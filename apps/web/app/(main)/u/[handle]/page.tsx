import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { setBlock, setFollow, setMute } from '@/app/actions'
import { Avatar } from '@/app/ui/avatar'
import { IdentityBadge } from '@/app/ui/identity-badge'
import { DotsIcon } from '@/app/ui/icons'
import { Menu } from '@/app/ui/menu'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { findProfile, getMemberPosts, getViewer, PROFILE_FILTERS, type ProfileFilter } from '@/lib/api'

type Props = PageProps<'/u/[handle]'>

export async function generateMetadata({ params }: Props) {
  return { title: `@${(await params).handle}` }
}

export default function ProfilePage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <ProfileView {...props} />
    </Suspense>
  )
}

const count = (n: number, one: string, many: string) => (
  <span>
    <span className="font-semibold text-ink">{n.toLocaleString('en-NG')}</span> {n === 1 ? one : many}
  </span>
)

const TABS: Record<ProfileFilter, { label: string; listLabel: string; none: string; older: string }> = {
  posts: { label: 'Posts', listLabel: 'Posts', none: 'has not posted yet', older: 'No older posts' },
  replies: { label: 'Replies', listLabel: 'Replies', none: 'has not replied to anyone yet', older: 'No older replies' },
  media: { label: 'Media', listLabel: 'Posts with images', none: 'has not posted any images yet', older: 'No older posts' },
}

const tabHref = (handle: string, tab: ProfileFilter) =>
  `/u/${encodeURIComponent(handle)}${tab === 'posts' ? '' : `?tab=${tab}`}`

async function ProfileView({ params, searchParams }: Props) {
  const [{ handle }, { cursor, tab: rawTab }] = await Promise.all([params, searchParams])
  const page = typeof cursor === 'string' ? cursor : undefined
  // Anything else, including a mangled ?tab=, shows the posts.
  const tab = PROFILE_FILTERS.find((t) => t === rawTab) ?? 'posts'

  const [profile, viewer] = await Promise.all([findProfile(handle), getViewer()])
  if (!profile) notFound()
  // A handle its owner gave up recently leads to the one they use now.
  if ('movedTo' in profile) redirect(`/u/${profile.movedTo}`)
  // Behind a block there is nothing to load: the API would return no posts anyway.
  const feed = profile.viewerBlocks ? { posts: [], cursor: null } : await getMemberPosts(profile.handle, tab, page)
  const viewerId = viewer.state === 'member' ? viewer.me.id : null

  return (
    <div className="page-stack">
      <header className="page-header profile-header">
        <p className="page-eyebrow">{profile.isSelf ? 'Your profile' : 'Member profile'}</p>
        <div className="profile-topline mt-4 flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 grow basis-52 items-center gap-4">
            <Avatar handle={profile.handle} src={profile.avatar} size={64} />
            <div className="min-w-0 flex-1">
              <h1 className="page-title break-words">
                {profile.displayName ?? `@${profile.handle}`}
                {profile.identityBadge ? <> <IdentityBadge /></> : null}
              </h1>
              {profile.displayName ? <p className="mt-1 break-words text-sm text-muted">@{profile.handle}</p> : null}
            </div>
          </div>

          {profile.isSelf ? (
            <Link href="/settings" className="btn btn-secondary">
              Edit profile
            </Link>
          ) : viewerId ? (
            <div className="flex shrink-0 items-center gap-1">
              {profile.viewerBlocks ? (
                <form action={setBlock}>
                  <input type="hidden" name="handle" value={profile.handle} />
                  <input type="hidden" name="on" value="0" />
                  <SubmitButton className="btn btn-secondary">Unblock</SubmitButton>
                </form>
              ) : (
                <form action={setFollow}>
                  <input type="hidden" name="handle" value={profile.handle} />
                  <input type="hidden" name="on" value={profile.viewerFollows ? '0' : '1'} />
                  <SubmitButton
                    pressed={profile.viewerFollows}
                    className={`btn ${profile.viewerFollows ? 'btn-secondary' : 'btn-primary'}`}
                  >
                    {profile.viewerFollows ? 'Following' : 'Follow'}
                  </SubmitButton>
                </form>
              )}

              <Menu label="More options" trigger={<DotsIcon />}>
                <form action={setMute}>
                  <input type="hidden" name="handle" value={profile.handle} />
                  <input type="hidden" name="on" value={profile.viewerMutes ? '0' : '1'} />
                  <SubmitButton className="menu-item">{profile.viewerMutes ? 'Unmute' : 'Mute'}</SubmitButton>
                </form>
                {profile.viewerBlocks ? null : (
                  <form action={setBlock}>
                    <input type="hidden" name="handle" value={profile.handle} />
                    <input type="hidden" name="on" value="1" />
                    <SubmitButton
                      className="menu-item menu-item-danger"
                      confirmMessage={`Block @${profile.handle}? You will stop seeing each other's posts.`}
                    >
                      Block
                    </SubmitButton>
                  </form>
                )}
                <Link href={`/report?member=${profile.handle}`} className="menu-item">
                  Report account
                </Link>
              </Menu>
            </div>
          ) : null}
        </div>

        {profile.bio ? <p className="mt-5 whitespace-pre-wrap break-words text-[15px] leading-6">{profile.bio}</p> : null}
        <p className="mt-4 text-xs text-muted">
          Joined{' '}
          {new Date(profile.joinedAt).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}
        </p>
        <p className="profile-stats mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-sm text-muted">
          {count(profile.postCount, 'post', 'posts')}
          {count(profile.followerCount, 'follower', 'followers')}
          {count(profile.followingCount, 'following', 'following')}
        </p>
      </header>

      {profile.viewerMutes && !profile.viewerBlocks ? (
        <p className="notice">You muted @{profile.handle}. Their posts only show here.</p>
      ) : null}

      {profile.viewerBlocks ? null : (
        <nav aria-label={`@${profile.handle}'s posts`} className="feed-tabs">
          {PROFILE_FILTERS.map((t) => (
            <Tab key={t} href={tabHref(profile.handle, t)} active={t === tab}>
              {TABS[t].label}
            </Tab>
          ))}
          <span className="feed-order"><span aria-hidden="true" /> Latest first</span>
        </nav>
      )}

      {/* Keyed so switching tabs starts a fresh list instead of reloading the old one's batches. */}
      <section key={tab} aria-label={`${TABS[tab].listLabel} by @${profile.handle}`} className="flex flex-col gap-3">
        <PostList
          posts={feed.posts}
          viewerId={viewerId}
          now={Date.now()}
          empty={
            profile.viewerBlocks
              ? { title: `You blocked @${profile.handle}`, detail: 'Unblock to see their posts.' }
              : page
                ? { title: TABS[tab].older }
                : { title: `@${profile.handle} ${TABS[tab].none}` }
          }
          more={{ source: { kind: 'member', handle: profile.handle, filter: tab }, cursor: feed.cursor }}
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
