import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { CommunityMark } from '@/app/ui/community-mark'
import { getCommunity, getGistReply, getProfile, getThread, getViewer } from '@/lib/api'
import { ReportForm } from './report-form'

export async function generateMetadata({ searchParams }: PageProps<'/report'>): Promise<Metadata> {
  const params = await searchParams
  // Nothing named is Report a safety concern.
  return { title: ['post', 'gist', 'member', 'community'].some((k) => typeof params[k] === 'string') ? 'Report' : 'Report a safety concern' }
}

export default function ReportPage({ searchParams }: PageProps<'/report'>) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <Report searchParams={searchParams} />
    </Suspense>
  )
}

async function Report({ searchParams }: Pick<PageProps<'/report'>, 'searchParams'>) {
  const viewer = await getViewer()
  if (viewer.state !== 'member') redirect('/login')

  const params = await searchParams
  const postId = typeof params.post === 'string' ? params.post : undefined
  const gistId = typeof params.gist === 'string' ? params.gist : undefined
  const handle = typeof params.member === 'string' ? params.member : undefined
  const communitySlug = typeof params.community === 'string' ? params.community : undefined

  // Nothing named: Report a safety concern, from Settings, for whatever a member saw or what happened to them.
  if (!postId && !gistId && !handle && !communitySlug) return <ReportConcern />

  // Show the member exactly what they are about to report.
  const gistPost = postId && gistId ? await getGistReply(gistId, postId) : null
  const thread = postId && !gistId ? await getThread(postId) : null
  const profile = !postId && handle ? await getProfile(handle) : null
  const community = !postId && !handle && communitySlug ? await getCommunity(communitySlug) : null
  const post = thread?.post ?? gistPost
  // A community with no photo has nothing to report.
  if (!post && !profile && !(community && community.photo)) notFound()

  return (
    <div className="content-panel">
      <header className="page-intro">
        <p className="page-eyebrow">Looking out for each other</p>
        <h1 className="page-title">{post ? 'Report a post' : community ? `Report the photo of ${community.name}` : `Report @${profile!.handle}`}</h1>
        <p className="page-description">Tell our moderators what’s wrong. Your report helps keep this community safe.</p>
      </header>
      {post ? (
        <blockquote className="mt-4 rounded-lg bg-panel p-4 text-sm">
          <span className="font-semibold">@{post.authorHandle}</span>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-muted">{post.text}</p>
        </blockquote>
      ) : null}
      {community ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-panel p-4 text-sm">
          <CommunityMark slug={community.slug} photo={community.photo} large />
          <span className="font-semibold">{community.name}</span>
        </div>
      ) : null}
      <div className="mt-4">
        <ReportForm
          postId={post?.id}
          gist={gistPost ? gistId : undefined}
          handle={profile?.handle}
          community={community?.slug}
          // A post not marked already, while marking is switched on (ADR 0020).
          needsLabel={Boolean(post && !gistPost && !post.sensitive && viewer.me.features?.adultLabels)}
        />
      </div>
    </div>
  )
}

function ReportConcern() {
  return (
    <div className="content-panel">
      <header className="page-intro">
        <p className="page-eyebrow">Looking out for each other</p>
        <h1 className="page-title">Report a safety concern</h1>
        <p className="page-description">
          Tell the people who handle safety about something you saw on HeyNaija or something that happened to you or
          someone you know, above all anything that puts a child at risk. Only they read it, and the people you name
          are not told who sent it. To report one post or account, you can also use Report in its menu. Something not
          working, or an idea? Use the{' '}
          <Link href="/ideas" className="font-semibold text-accent-strong hover:underline">
            ideas board
          </Link>
          .
        </p>
      </header>
      <div className="mt-4">
        <ReportForm />
      </div>
      <p className="mt-6 text-sm text-muted">
        If a child is in danger now, call the police first: in Nigeria, 112. How we handle child sexual abuse and
        exploitation is in our{' '}
        <Link href="/child-safety" className="font-semibold text-accent-strong hover:underline">
          child safety standards
        </Link>
        .
      </p>
    </div>
  )
}
