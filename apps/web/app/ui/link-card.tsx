import type { LinkPreview } from '@/lib/api'

/**
 * The page a post links to, as a card. The picture is our own copy, never the
 * linked site's, so showing it tells that site nothing about the reader. The host
 * shown is the one the link really goes to; the title and text are the page's
 * own words and are shown as plain text only.
 */
export function LinkCard({ preview }: { preview: LinkPreview }) {
  const { image } = preview
  let host = ''
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  return (
    <a href={preview.url} target="_blank" rel="nofollow noopener noreferrer ugc" className="link-card">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- already resized to the size we need
        <img
          src={`${image.src}/640.webp`}
          width={image.width}
          height={image.height}
          alt=""
          loading="lazy"
          decoding="async"
          className="link-card-image"
          // Wider than 2:1 or taller than square is cropped to the middle, as photos in a post are.
          style={{ aspectRatio: Math.min(Math.max(image.width / image.height, 1), 2) }}
        />
      ) : null}
      <span className="link-card-body">
        <span className="link-card-host">{host}</span>
        <span className="link-card-title">{preview.title}</span>
        {preview.description ? <span className="link-card-text">{preview.description}</span> : null}
        <span className="sr-only"> (opens in a new tab)</span>
      </span>
    </a>
  )
}
