import Link from 'next/link'
import type { Post } from '@/lib/api'
import { ChevronIcon, PlusIcon } from './icons'
import { PostItem } from './post-item'

/**
 * A story's updates under its first post, oldest first, joined by a line in the
 * gutter that curves into each one. With `folded`, the earlier updates wait
 * behind one link. Replies to an update are on its own page.
 */
export function StorySpine({ story, updates, folded, viewerId, now }: {
  story: Post
  updates: Post[]
  /** How many earlier updates are left out. */
  folded: number
  viewerId: string | null
  now: number
}) {
  const next = (story.story?.updates ?? 0) + 1
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
      {viewerId === story.authorId ? (
        <li className="story-add">
          <Link prefetch={false} href={`/p/${story.id}/update`}>
            <PlusIcon size={16} />
            Add update {next}
          </Link>
        </li>
      ) : null}
    </ol>
  )
}
