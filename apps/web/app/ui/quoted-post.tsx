import Link from 'next/link'
import type { QuotedPost } from '@/lib/api'
import { Avatar } from './avatar'
import { timeAgo } from './time'

/**
 * The post a quote post quotes, shown inside it as one link to that post. Its
 * images are small previews here; they open full size on the post itself.
 */
export function QuotedPostCard({ quote, now }: { quote: QuotedPost; now: number }) {
  if (quote.unavailable) {
    return <p className="quoted-post is-unavailable">This post is no longer available.</p>
  }
  return (
    <Link prefetch={false} href={`/p/${quote.id}`} className="quoted-post">
      <span className="quoted-post-label">Quoted post</span>
      <span className="quoted-post-meta">
        <Avatar handle={quote.authorHandle} src={quote.authorAvatar} size={28} />
        <span className="quoted-post-identity">
          <span className="truncate font-semibold text-ink">{quote.authorName ?? `@${quote.authorHandle}`}</span>
          {quote.authorName ? <span className="truncate">@{quote.authorHandle}</span> : null}
        </span>
        <time dateTime={quote.createdAt} className="shrink-0">
          {timeAgo(quote.createdAt, now)}
        </time>
      </span>
      {quote.replyParentId ? <span className="quoted-post-note">Replying to a post</span> : null}
      {quote.text ? <span className="quoted-post-text">{quote.text}</span> : null}
      {quote.images.length ? (
        <span className="quoted-post-images" data-count={quote.images.length}>
          {quote.images.map((image) => (
            // eslint-disable-next-line @next/next/no-img-element -- already resized; next/image would resize again
            <img key={image.src} src={`${image.src}/640.webp`} alt={image.alt} loading="lazy" decoding="async" />
          ))}
        </span>
      ) : null}
    </Link>
  )
}
