'use client'

import { useActionState, useEffect, useState } from 'react'
import { type ComposeState, createPost } from '@/app/actions'

const LIMIT = 300
const segmenter = new Intl.Segmenter()
const graphemes = (text: string) => [...segmenter.segment(text)].length

export function Composer() {
  const [state, action, pending] = useActionState<ComposeState, FormData>(createPost, {})
  const [text, setText] = useState('')

  // Clear the box once the server confirms the post.
  useEffect(() => {
    if (state.postedAt) setText('')
  }, [state.postedAt])

  const left = LIMIT - graphemes(text.trim())

  return (
    <form action={action} className="rounded-2xl border border-line bg-surface p-3">
      <label htmlFor="post-text" className="sr-only">
        New post
      </label>
      <textarea
        id="post-text"
        name="text"
        rows={3}
        required
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Wetin dey happen?"
        className="block w-full resize-none bg-transparent text-base placeholder:text-muted focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Posts are public. Anyone can see and copy them, including outside heynaija.
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <span className={`text-xs tabular-nums ${left < 0 ? 'text-danger' : 'text-muted'}`}>{left}</span>
          <button
            type="submit"
            disabled={pending || left < 0 || left === LIMIT}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {pending ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
      <p role="alert" className="mt-2 text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </form>
  )
}
