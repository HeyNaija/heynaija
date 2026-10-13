import Link from 'next/link'
import { Suspense } from 'react'
import { deletePost } from '@/app/actions'
import { Composer } from '@/app/ui/composer'
import { DeleteButton } from '@/app/ui/delete-button'
import { getFeed, getViewer, type Post } from '@/lib/api'
import { getLogoutUrl } from '@/lib/kratos'

export default function HomePage({ searchParams }: PageProps<'/'>) {
  // Everything that depends on the visitor streams in; the shell renders at once.
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <Home searchParams={searchParams} />
    </Suspense>
  )
}

async function Home({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
  const { cursor } = await searchParams
  const [viewer, feed] = await Promise.all([getViewer(), getFeed(typeof cursor === 'string' ? cursor : undefined)])
  const me = viewer.state === 'member' ? viewer.me : null
  const logoutUrl = viewer.state === 'anonymous' ? null : await getLogoutUrl()
  const now = Date.now()

  return (
    <div className="flex flex-col gap-4">
      {me ? (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="truncate text-muted">
              Signed in as <span className="font-medium text-ink">@{me.handle}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <Link href="/settings" className="text-muted underline underline-offset-2">
                Account
              </Link>
              <SignOutLink href={logoutUrl} />
            </span>
          </div>
          <Composer />
        </>
      ) : viewer.state === 'blocked' ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">
            This account cannot post. It was not created with an invite, or it has been suspended.
          </p>
          <SignOutLink href={logoutUrl} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">Join the conversation. heynaija is invite-only for now.</p>
          <span className="flex shrink-0 items-center gap-3">
            <Link href="/login" className="text-sm underline underline-offset-2">
              Sign in
            </Link>
            <Link href="/join" className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
              Join
            </Link>
          </span>
        </div>
      )}

      <section aria-label="Latest posts">
        {feed.posts.length === 0 ? (
          <p className="py-12 text-center text-muted">
            {cursor ? 'No older posts.' : 'No posts yet. Be the first to say something.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {feed.posts.map((post) => (
              <PostItem key={post.id} post={post} mine={post.authorId === me?.id} now={now} />
            ))}
          </ul>
        )}

        {feed.cursor ? (
          <Link
            href={`/?cursor=${encodeURIComponent(feed.cursor)}`}
            className="mt-4 block rounded-full border border-line py-2 text-center text-sm font-medium"
          >
            Older posts
          </Link>
        ) : null}
      </section>
    </div>
  )
}

// A plain link, not a router navigation: Kratos ends the session on this request
// and must receive it exactly once, straight from the browser.
function SignOutLink({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <a href={href} className="rounded px-1 text-sm text-muted underline underline-offset-2">
      Sign out
    </a>
  )
}

function PostItem({ post, mine, now }: { post: Post; mine: boolean; now: number }) {
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-semibold">@{post.authorHandle}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted">
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toUTCString()}>
            {timeAgo(post.createdAt, now)}
          </time>
          {mine ? (
            <form action={deletePost}>
              <input type="hidden" name="id" value={post.id} />
              <DeleteButton />
            </form>
          ) : null}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words">{post.text}</p>
    </li>
  )
}

function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d`
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading posts" className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-line/60" />
      ))}
    </div>
  )
}
