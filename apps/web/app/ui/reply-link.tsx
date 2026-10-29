'use client'

import { BubbleIcon } from './icons'
import { useMine } from './my-activity'
import { ComposeLink } from './new-post-link'

/**
 * A post's reply button and count. A reply the reader wrote on the post's page
 * counts here too when the browser brings this page back on Back (see my-activity).
 */
export function ReplyLink({ id, href, count: drawn }: { id: string; href: string; count: number }) {
  const mine = useMine(id)?.replies
  // Only while this is the count drawn before the reply; a newer drawing has the reply in it.
  const count = mine && mine.base === drawn ? mine.count : drawn
  const replies = count === 1 ? '1 reply' : `${count} replies`
  return (
    <ComposeLink href={href} prefetch={false} className="icon-btn" label={`Reply (${replies})`}>
      <BubbleIcon size={18} />
      <span className="tabular-nums">{count}</span>
    </ComposeLink>
  )
}
