'use client'

import { useState, useTransition } from 'react'
import { setLike, toggleLike } from '@/app/actions'
import { HeartIcon } from './icons'

/**
 * Like or unlike a post. With JavaScript the heart changes at once and the page is
 * left alone; if the server refuses, it changes back. Without JavaScript the form
 * posts to setLike and the page reloads, as before.
 */
export function LikeButton({ id, liked, count }: { id: string; liked: boolean; count: number }) {
  const [state, setState] = useState({ liked, count })
  // Follow the server when it re-renders this post with newer numbers.
  const [from, setFrom] = useState({ liked, count })
  if (from.liked !== liked || from.count !== count) {
    setFrom({ liked, count })
    setState({ liked, count })
  }
  const [pending, startTransition] = useTransition()
  const likes = state.count === 1 ? '1 like' : `${state.count} likes`

  return (
    <form
      action={setLike}
      onSubmit={(e) => {
        e.preventDefault()
        if (pending) return
        const before = state
        const on = !state.liked
        setState({ liked: on, count: Math.max(0, state.count + (on ? 1 : -1)) })
        startTransition(async () => {
          const result = await toggleLike(id, on).catch(() => ({ ok: false }))
          if (!result.ok) setState(before)
        })
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="on" value={state.liked ? '0' : '1'} />
      <button
        type="submit"
        className="icon-btn"
        aria-label={state.liked ? `Unlike (${likes})` : `Like (${likes})`}
        aria-pressed={state.liked}
      >
        <HeartIcon size={18} filled={state.liked} />
        <span className="tabular-nums">{state.count}</span>
      </button>
    </form>
  )
}
