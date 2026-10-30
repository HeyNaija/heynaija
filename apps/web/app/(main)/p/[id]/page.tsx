import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostItem, PostsSkeleton } from '@/app/ui/post-item'
import { ThreadConversation } from '@/app/ui/thread-conversation'
import { renderThreadRow } from '@/app/ui/thread-row'
import { IdeaPanel } from '@/app/ui/idea-panel'
import { getIdea, getReplies, getThread, getViewer } from '@/lib/api'
import { defaultPreviewImage, excerpt, siteOpenGraph } from '@/lib/previews'
import type { ReplyOrder } from '@/lib/thread-state'
import { ChevronIcon } from '@/app/ui/icons'
import { ThreadAuthorProvider } from '@/app/ui/thread-author'
import { BackToFeed } from '@/app/ui/back-to-feed'

type Props = PageProps<'/p/[id]'>

/** How many posts above the parent stay open before the rest fold into one disclosure. */
const CHAIN_OPEN = 12

/**
 * What a link to the post shows when pasted into WhatsApp or X. It asks the API
 * exactly as the page does (the fetch is shared), so a post the visitor cannot
 * see (deleted, removed, by someone blocked) gets a generic title and no text.
 * Preview fetchers are signed out, so they get what any visitor would.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const post = (await getThread(id))?.post
  if (!post || post.deleted) return { title: 'Post', openGraph: { ...siteOpenGraph, type: 'website', images: [defaultPreviewImage] } }

  const title = `@${post.authorHandle} on HeyNaija`
  // A post always has text, images or both.
  const photos = post.images.length === 1 ? 'a photo' : `${post.images.length} photos`
  const description = post.text ? excerpt(post.text) : `@${post.authorHandle} shared ${photos}.`
  const first = post.images[0]
  // The 640px copy (a GIF's first frame): big enough for a preview card, small enough for WhatsApp to fetch.
  const scale = first ? Math.min(1, 640 / Math.max(first.width, first.height)) : 1
  const image = first
    ? { url: `${first.src}/${first.animated ? 'still' : '640'}.webp`, width: Math.round(first.width * scale), height: Math.round(first.height * scale), alt: first.alt }
    : defaultPreviewImage

  return {
    title: { absolute: title },
    description,
    openGraph: { ...siteOpenGraph, type: 'article', url: `/p/${post.id}`, publishedTime: post.createdAt, images: [image] },
    twitter: { card: 'summary_large_image' },
  }
}

export default function ThreadPage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <ThreadView {...props} />
    </Suspense>
  )
}

async function ThreadView({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const order: ReplyOrder = query.replies === 'oldest' ? 'oldest' : 'newest'
  const [thread, viewer, idea] = await Promise.all([getThread(id, order), getViewer(), getIdea(id).catch(() => null)])
  if (!thread) notFound()

  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  const now = Date.now()
  // Plain pagination links keep branch reading available without JavaScript.
  const page = typeof query.repliesCursor === 'string'
    ? await getReplies(id, query.repliesCursor, order).catch(() => null)
    : null
  const replies = page?.replies ?? thread.replies
  const cursor = page ? page.cursor : thread.replyCursor
  const parent = thread.ancestors.find((post) => post.id === thread.post.replyParentId)
  const older = thread.ancestors.filter((post) => post.id !== parent?.id)
  // Older posts are shown in full, down to the parent; a very long chain (the API
  // sends up to 50) keeps its nearest posts open and folds the rest away.
  const folded = older.slice(0, Math.max(0, older.length - CHAIN_OPEN))
  const shown = older.slice(folded.length)
  const chain = older.length > 0 || parent !== undefined || thread.ancestorsTruncated || !!thread.post.replyParentId
  // A truncated or unavailable root must not make the focused reply's author
  // look like the original poster. Only identify a visible top-level post.
  const original = [...thread.ancestors, thread.post].find((post) => !post.replyParentId && !post.deleted)

  return (
    <ThreadAuthorProvider authorId={original?.authorId ?? null}>
    <div className={`thread-view flex flex-col${parent ? ' has-chain' : ''}`}>
      <BackToFeed className="self-start text-sm font-medium text-muted hover:text-ink hover:underline" />

      {idea ? <IdeaPanel idea={idea} member={viewer.state === 'member'} /> : null}

      {/* The conversation so far, each post leading down to the one in focus. Short
          lines between the cards join them (decorative: the order and the "Replying
          to" line say the same in words). */}
      {chain ? (
        <div className="thread-lineage">
          {thread.ancestorsTruncated ? (
            <p className="thread-context-note">
              Earlier posts are outside this view.
              {thread.earlierAncestorId ? <> <Link prefetch={false} href={`/p/${thread.earlierAncestorId}`}>Continue earlier conversation</Link></> : null}
            </p>
          ) : null}
          {folded.length ? (
            <details className="thread-context">
              <summary className="menu">
                <span>Show {folded.length} earlier {folded.length === 1 ? 'post' : 'posts'}</span>
                <ChevronIcon size={16} />
              </summary>
              <ol aria-label="Earlier in this conversation" className="thread-chain">
                {folded.map((post) => (
                  <li key={post.id}>
                    <PostItem post={post} viewerId={viewerId} now={now} inThread />
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          {shown.length || parent ? (
            <ol aria-label={folded.length ? 'Recent posts in this conversation' : 'Earlier in this conversation'} className="thread-chain">
              {shown.map((post) => (
                <li key={post.id}>
                  <PostItem post={post} viewerId={viewerId} now={now} inThread />
                </li>
              ))}
              {parent ? (
                <li key={parent.id} className="is-parent">
                  <PostItem post={parent} viewerId={viewerId} now={now} inThread />
                </li>
              ) : null}
            </ol>
          ) : null}
          {thread.post.replyParentId ? (
            <p className="thread-recipient">
              {parent && !parent.deleted ? `Replying to @${parent.authorHandle}` : 'Replying to an earlier post'}
            </p>
          ) : null}
        </div>
      ) : null}

      <ThreadConversation
        key={`${viewerId ?? 'visitor'}:${id}:${order}`}
        focus={{ id, parentId: thread.post.replyParentId, handle: thread.post.authorHandle, depth: 0 }}
        member={viewer.state === 'member' && thread.post.viewerCanReply ? { handle: viewer.me.handle, avatar: viewer.me.avatar } : null}
        limited={viewer.state === 'member' && !thread.post.viewerCanReply}
        initialRows={replies.map((post) => renderThreadRow(post, viewerId, now, 1, thread.post.authorHandle))}
        cursor={cursor}
        order={order}
        version={now}
      >
        {renderThreadRow(thread.post, viewerId, now, 0, parent && !parent.deleted ? parent.authorHandle : null, true).node}
      </ThreadConversation>
    </div>
    </ThreadAuthorProvider>
  )
}
