'use client'

import { useTransition } from 'react'
import { setLike, toggleLike } from '@/app/actions'
import { HeartIcon } from './icons'
import { remember, useMine, withChoice } from './my-activity'

/**
 * Like or unlike a post. With JavaScript the heart changes at once, everywhere the
 * post is on screen or comes back to it, and the page is left alone; if the
 * server refuses, it changes back. Without JavaScript the form posts to setLike
 * and the page reloads, as before.
 */
export function LikeButton({ id, liked: drawn, count: drawnCount }: { id: string; liked: boolean; count: number }) {
  // The server's numbers, with the reader's latest choice in this tab, if any.
  const liked = useMine(id)?.liked ?? drawn
  const count = withChoice(drawnCount, drawn, liked)
  const [pending, startTransition] = useTransition()
  const likes = count === 1 ? '1 like' : `${count} likes`

  return (
    <form
      action={setLike}
      onSubmit={(e) => {
        e.preventDefault()
        if (pending) return
        const on = !liked
        remember(id, { liked: on })
        startTransition(async () => {
          const result = await toggleLike(id, on).catch(() => ({ ok: false }))
          if (!result.ok) remember(id, { liked: !on })
        })
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="on" value={liked ? '0' : '1'} />
      <button
        type="submit"
        className="icon-btn"
        aria-label={liked ? `Unlike (${likes})` : `Like (${likes})`}
        aria-pressed={liked}
      >
        <HeartIcon size={18} filled={liked} />
        <span className="tabular-nums">{count}</span>
      </button>
    </form>
  )
}
