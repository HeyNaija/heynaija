import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Post } from '@/lib/api'
import { ChevronIcon } from './icons'
import { PostItem } from './post-item'

/**
 * A story's updates under its first post, oldest first, joined by a line in the
 * gutter that curves into each one. With `folded`, the earlier updates wait
 * behind one link. For its author, `writer` is the box at the end that adds the
 * next one. Replies to an update are on its own page.
 */
export function StorySpine({ story, updates, folded, viewerId, now, writer }: {
  story: Post
  updates: Post[]
  /** How many earlier updates are left out. */
  folded: number
  viewerId: string | null
  now: number
  writer?: ReactNode
}) {
  return (
    <ol id="updates" className="story-spine" aria-label="Updates">
      {folded > 0 ? (
        <li className="story-fold">
          <Link prefetch={false} href={`/p/${story.id}?updates=all#updates`} scroll={false}>
            <ChevronIcon size={16} />
            {folded === 1 ? 'Update 1' : `Updates 1 to ${folded}`}
          </Link>
        </li>
      ) : null}
      {updates.map((update) => (
        <li key={update.id}>
          <PostItem post={update} viewerId={viewerId} now={now} inThread />
        </li>
      ))}
      {writer ? <li className="story-add">{writer}</li> : null}
    </ol>
  )
}
