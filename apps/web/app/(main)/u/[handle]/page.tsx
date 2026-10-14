import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { setBlock, setFollow, setMute } from '@/app/actions'
import { Avatar } from '@/app/ui/avatar'
import { DotsIcon } from '@/app/ui/icons'
import { Menu } from '@/app/ui/menu'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { getMemberPosts, getProfile, getViewer } from '@/lib/api'

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

async function ProfileView({ params, searchParams }: Props) {
  const [{ handle }, { cursor }] = await Promise.all([params, searchParams])
  const page = typeof cursor === 'string' ? cursor : undefined

  const [profile, viewer] = await Promise.all([getProfile(handle), getViewer()])
  if (!profile) notFound()
  // Behind a block there is nothing to load: the API would return no posts anyway.
  const feed = profile.viewerBlocks ? { posts: [], cursor: null } : await getMemberPosts(profile.handle, page)
  const viewerId = viewer.state === 'member' ? viewer.me.id : null

  return (
    <div className="page-stack">
      <header className="page-header profile-header">
        <p className="page-eyebrow">{profile.isSelf ? 'Your profile' : 'Member profile'}</p>
        <div className="profile-topline mt-4 flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 grow basis-52 items-center gap-4">
            <Avatar handle={profile.handle} src={profile.avatar} size={64} />
            <div className="min-w-0 flex-1">
              <h1 className="page-title break-words">{profile.displayName ?? `@${profile.handle}`}</h1>
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

      <section aria-label={`Posts by @${profile.handle}`} className="flex flex-col gap-3">
        <div className="section-heading">
          <h2 className="section-title">Posts</h2>
          <span className="text-xs text-muted">Latest first</span>
        </div>
        <PostList
          posts={feed.posts}
          viewerId={viewerId}
          now={Date.now()}
          empty={
            profile.viewerBlocks
              ? { title: `You blocked @${profile.handle}`, detail: 'Unblock to see their posts.' }
              : page
                ? { title: 'No older posts' }
                : { title: `@${profile.handle} has not posted yet` }
          }
          olderHref={feed.cursor ? `/u/${profile.handle}?cursor=${encodeURIComponent(feed.cursor)}` : null}
        />
      </section>
    </div>
  )
}
