'use client'

import { useActionState, useEffect, useState } from 'react'
import { type ComposeState, createPost } from '@/app/actions'
import { Avatar } from './avatar'
import { PeopleIcon } from './icons'

const LIMIT = 300
const segmenter = new Intl.Segmenter()
const graphemes = (text: string) => [...segmenter.segment(text)].length

type Props = {
  /** The member writing; shown as their avatar. */
  handle: string
  replyTo?: string
  placeholder?: string
  /** Post straight into this community (used on a community's own page). */
  community?: string
  /** Or let the member choose among the communities they have joined. */
  choices?: { slug: string; name: string }[]
}

export function Composer({ handle, replyTo, placeholder = "What's on your mind?", community, choices }: Props) {
  const [state, action, pending] = useActionState<ComposeState, FormData>(createPost, {})
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(false)

  // Clear the box once the server confirms the post.
  useEffect(() => {
    if (state.postedAt) setText('')
  }, [state.postedAt])

  const left = LIMIT - graphemes(text.trim())

  return (
    <form id="compose" action={action} className="square-card square-composer scroll-mt-24">
      {replyTo ? <input type="hidden" name="replyTo" value={replyTo} /> : null}
      {community ? <input type="hidden" name="community" value={community} /> : null}

      <div className="flex gap-3">
        <Avatar handle={handle} />
        <div className="min-w-0 flex-1">
          <label htmlFor="post-text" className="sr-only">
            {replyTo ? 'Your reply' : 'New post'}
          </label>
          <textarea
            id="post-text"
            name="text"
            rows={replyTo ? 2 : expanded || text ? 3 : 1}
            onFocus={() => setExpanded(true)}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="composer-input"
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {choices?.length ? (
              <label className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                <PeopleIcon size={18} />
                <span className="sr-only">Post to</span>
                <select
                  name="community"
                  defaultValue=""
                  className="min-w-0 max-w-44 rounded-lg bg-transparent py-1 text-[13px] font-semibold text-ink"
                >
                  <option value="">Everyone</option>
                  {choices.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : replyTo ? null : (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
                <PeopleIcon size={18} />
                {community ? 'Posting to this community' : 'Everyone'}
              </span>
            )}
            <span className={`ml-auto text-xs tabular-nums ${left < 0 ? 'text-danger' : 'text-muted'}`}>{left}</span>
            <button
              type="submit"
              disabled={pending || left < 0 || left === LIMIT}
              className="btn btn-primary"
            >
              {pending ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
            </button>
          </div>

          <p className="mt-2 text-xs text-muted">Posts are public. Anyone can see and copy them.</p>
          <p role="alert" className="mt-1 text-sm text-danger empty:hidden">
            {state.error}
          </p>
        </div>
      </div>
    </form>
  )
}
