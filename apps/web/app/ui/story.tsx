import Link from 'next/link'
import { setStoryFollow } from '@/app/actions'
import type { Post, PostStory } from '@/lib/api'
import { excerpt } from '@/lib/previews'
import { Avatar } from './avatar'
import { BellIcon, StoryIcon } from './icons'
import { SubmitButton } from './submit-button'

// Stories (docs/adr/0024): one author's updates to a post, in order.

export const updatesLabel = (n: number) => `${n} ${n === 1 ? 'update' : 'updates'}`

/**
 * Above an update outside its story: the story's first post on one line, joined
 * to the update by a short line in the gap, and how many updates there are.
 */
export function StoryStart({ story }: { story: PostStory }) {
  const start = story.start
  const count = (
    <span className="story-start-count">
      <StoryIcon size={14} />
      Story · {updatesLabel(story.updates)}
    </span>
  )
  if (!start || start.unavailable) {
    return (
      <p className="story-start">
        <span className="story-start-text">The start of this story is no longer available.</span>
        {count}
      </p>
    )
  }
  return (
    <Link prefetch={false} href={`/p/${story.id}`} className="story-start">
      <Avatar handle={start.authorHandle} src={start.authorAvatar} size={20} />
      <span className="story-start-text">
        <span className="sr-only">The story so far, by @{start.authorHandle}: </span>
        {excerpt(start.text, 120) || 'Photos'}
      </span>
      {count}
    </Link>
  )
}

/** In the bar's place while the author writes the first update of a post that is not a story yet. */
export function StoryNew() {
  return (
    <div className="story-bar">
      <p className="story-bar-text">
        <StoryIcon size={16} />
        <span>New story: updates go under this post in order, and feeds show it once, at its newest.</span>
      </p>
    </div>
  )
}

/** Under a story's first post: how many updates and followers, and Follow story for everyone but its author. */
export function StoryBar({ post, viewerId }: { post: Post; viewerId: string | null }) {
  const story = post.story!
  return (
    <div className="story-bar">
      <p className="story-bar-text">
        <StoryIcon size={16} />
        <span>
          Story · {updatesLabel(story.updates)}
          {story.followers ? ` · ${story.followers} following` : ''}
        </span>
      </p>
      {viewerId === post.authorId ? null : viewerId ? (
        <form action={setStoryFollow}>
          <input type="hidden" name="id" value={story.id} />
          <input type="hidden" name="on" value={story.following ? '0' : '1'} />
          <SubmitButton className={`btn btn-sm ${story.following ? 'btn-secondary' : 'btn-primary'}`} pressed={story.following}>
            <BellIcon size={15} />
            {story.following ? 'Following' : 'Follow story'}
          </SubmitButton>
        </form>
      ) : (
        <Link prefetch={false} href="/login" className="btn btn-sm btn-secondary">
          <BellIcon size={15} />
          Follow story
        </Link>
      )}
    </div>
  )
}
