import Link from 'next/link'
import { Fragment } from 'react'
import type { TextPart } from '@/lib/mentions'

/** Post text with each mention linked to the profile it leads to now; the rest as written. */
export function PostText({ parts }: { parts: TextPart[] }) {
  return parts.map((part, i) =>
    part.handle ? (
      <Link key={i} prefetch={false} href={`/u/${part.handle}`} className="post-mention">
        {part.text}
      </Link>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  )
}
