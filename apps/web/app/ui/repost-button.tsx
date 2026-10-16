'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { setRepost, toggleRepost } from '@/app/actions'
import { QuoteIcon, RepostIcon } from './icons'
import { Menu } from './menu'

/**
 * Repost a post as it is, or quote it with your own words, from a small menu.
 * With JavaScript a repost shows at once and changes back if the server refuses,
 * as a like does; without it the menu still opens (it is a <details>) and the
 * form posts to setRepost.
 */
export function RepostButton({ id, reposted, count }: { id: string; reposted: boolean; count: number }) {
  const [state, setState] = useState({ reposted, count })
  // Follow the server when it re-renders this post with newer numbers.
  const [from, setFrom] = useState({ reposted, count })
  if (from.reposted !== reposted || from.count !== count) {
    setFrom({ reposted, count })
    setState({ reposted, count })
  }
  const [pending, startTransition] = useTransition()
  const reposts = state.count === 1 ? '1 repost' : `${state.count} reposts`

  return (
    <Menu
      label={state.reposted ? `Reposted. Undo or quote (${reposts})` : `Repost or quote (${reposts})`}
      trigger={
        <>
          <RepostIcon size={18} />
          <span className="tabular-nums">{state.count}</span>
        </>
      }
      triggerClassName={`icon-btn ${state.reposted ? 'is-reposted' : ''}`}
      className="repost-menu"
    >
      <form
        action={setRepost}
        onSubmit={(e) => {
          e.preventDefault()
          e.currentTarget.closest('details')?.removeAttribute('open')
          if (pending) return
          const before = state
          const on = !state.reposted
          setState({ reposted: on, count: Math.max(0, state.count + (on ? 1 : -1)) })
          startTransition(async () => {
            const result = await toggleRepost(id, on).catch(() => ({ ok: false }))
            if (!result.ok) setState(before)
          })
        }}
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="on" value={state.reposted ? '0' : '1'} />
        <button type="submit" className="menu-item">
          <RepostIcon size={18} />
          {state.reposted ? 'Undo repost' : 'Repost'}
        </button>
      </form>
      <Link prefetch={false} href={`/p/${id}/quote#compose`} className="menu-item">
        <QuoteIcon size={18} />
        Quote
      </Link>
    </Menu>
  )
}
