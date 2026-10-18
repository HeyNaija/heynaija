import Link from 'next/link'
import { Fragment } from 'react'
import type { TextPart } from '@/lib/mentions'

/**
 * Post text with each mention linked to the profile it leads to now, each web
 * address linked to its page, and the rest as written. Addresses open in a new
 * tab and tell search engines the link was written by a member, not by us.
 */
export function PostText({ parts }: { parts: TextPart[] }) {
  return parts.map((part, i) =>
    part.handle ? (
      <Link key={i} prefetch={false} href={`/u/${part.handle}`} className="post-mention">
        {part.text}
      </Link>
    ) : part.href ? (
      <a key={i} href={part.href} target="_blank" rel="nofollow noopener noreferrer ugc" className="post-link">
        {/* A long address is shortened on screen, but read out in full. */}
        {part.label === part.text ? (
          part.text
        ) : (
          <>
            <span aria-hidden="true">{part.label}</span>
            <span className="sr-only">{part.text}</span>
          </>
        )}
      </a>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  )
}
