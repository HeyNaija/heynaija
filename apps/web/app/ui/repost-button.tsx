'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { setRepost, toggleRepost } from '@/app/actions'
import { QuoteIcon, RepostIcon } from './icons'
import { Menu } from './menu'
import { remember, useMine, withChoice } from './my-activity'

/**
 * Repost a post as it is, or quote it with your own words, from a small menu.
 * With JavaScript a repost shows at once and changes back if the server refuses,
 * as a like does; without it the menu still opens (it is a <details>) and the
 * form posts to setRepost.
 */
export function RepostButton({ id, reposted: drawn, count: drawnCount }: { id: string; reposted: boolean; count: number }) {
  // The server's numbers, with the reader's latest choice in this tab, if any (see LikeButton).
  const reposted = useMine(id)?.reposted ?? drawn
  const count = withChoice(drawnCount, drawn, reposted)
  const [pending, startTransition] = useTransition()
  const reposts = count === 1 ? '1 repost' : `${count} reposts`

  return (
    <Menu
      label={reposted ? `Reposted. Undo or quote (${reposts})` : `Repost or quote (${reposts})`}
      trigger={
        <>
          <RepostIcon size={18} />
          <span className="tabular-nums">{count}</span>
        </>
      }
      triggerClassName={`icon-btn ${reposted ? 'is-reposted' : ''}`}
      className="repost-menu"
    >
      <form
        action={setRepost}
        onSubmit={(e) => {
          e.preventDefault()
          e.currentTarget.closest('details')?.removeAttribute('open')
          if (pending) return
          const on = !reposted
          remember(id, { reposted: on })
          startTransition(async () => {
            const result = await toggleRepost(id, on).catch(() => ({ ok: false }))
            if (!result.ok) remember(id, { reposted: !on })
          })
        }}
      >
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="on" value={reposted ? '0' : '1'} />
        <button type="submit" className="menu-item">
          <RepostIcon size={18} />
          {reposted ? 'Undo repost' : 'Repost'}
        </button>
      </form>
      <Link prefetch={false} href={`/p/${id}/quote#compose`} className="menu-item">
        <QuoteIcon size={18} />
        Quote
      </Link>
    </Menu>
  )
}
