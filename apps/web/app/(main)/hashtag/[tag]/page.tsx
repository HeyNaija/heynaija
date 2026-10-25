import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getHashtagPosts, getViewer } from '@/lib/api'
import { hashtagHref, hashtagKey, isHashtag, tagParam } from '@/lib/hashtags'
import { defaultPreviewImage, siteOpenGraph } from '@/lib/previews'

type Props = PageProps<'/hashtag/[tag]'>

/** Every spelling of a hashtag shows the same posts, so search engines are pointed at one address. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = tagParam((await params).tag)
  const canonical = hashtagHref(hashtagKey(tag))
  return {
    title: `#${tag}`,
    description: `Posts and replies about #${tag} on HeyNaija.`,
    alternates: { canonical },
    openGraph: { ...siteOpenGraph, url: canonical, images: [defaultPreviewImage] },
  }
}

export default function HashtagPage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <HashtagView {...props} />
    </Suspense>
  )
}

async function HashtagView({ params, searchParams }: Props) {
  const [{ tag: raw }, { cursor }] = await Promise.all([params, searchParams])
  const tag = tagParam(raw)
  // What could never be a hashtag is not worth asking the API about.
  if (!isHashtag(tag)) notFound()
  const page = typeof cursor === 'string' ? cursor : undefined

  const [feed, viewer] = await Promise.all([getHashtagPosts(tag, page), getViewer()])
  if (!feed) notFound()
  const viewerId = viewer.state === 'member' ? viewer.me.id : null

  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Hashtag</p>
        <h1 className="page-title break-words">#{tag}</h1>
        <p className="page-description">Posts and replies tagged #{tag}, newest first.</p>
      </header>

      <section aria-label={`Posts with #${tag}`} className="flex flex-col gap-3">
        <PostList
          posts={feed.posts}
          viewerId={viewerId}
          now={Date.now()}
          empty={
            page
              ? { title: 'No older posts' }
              : { title: `Nothing about #${tag} yet`, detail: `Write #${tag} in a post and it will be listed here.` }
          }
          more={{ source: { kind: 'hashtag', tag }, cursor: feed.cursor }}
        />
      </section>
    </div>
  )
}
