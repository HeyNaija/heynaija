'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import { AwardIcon } from './icons'

export const FOUNDER_LABEL = 'Founder'
export const FOUNDER_TOOLTIP = 'One of the people who founded HeyNaija. Their posts are their own views, not decisions by HeyNaija.'

/**
 * The Founder badge: one of the people who founded HeyNaija, given by hand with
 * `pnpm founder:grant` and kept for good. Render it only where the API says so
 * (`founderBadge` on a profile, `authorFounder` on a post, `founder` on a
 * member). A gold award, not a tick, so it is never read as the green identity
 * tick; it stands beside that tick rather than combining with it, and says
 * nothing about identity checks.
 *
 * Like the tick, it links to what it means (the idea behind HeyNaija, on the
 * About page) and names itself in a tooltip on hover and keyboard focus that closes
 * with Escape. `plain` is for places that are already one link (a quoted post,
 * a notification, a search result): no link of its own, and the tooltip shows
 * on hover only.
 */
export function FounderBadge({ plain = false, size = 16 }: { plain?: boolean; size?: number }) {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const tip = (
    <span role="tooltip" id={tipId} className="identity-badge-tip" data-open={open || undefined} aria-hidden={plain || undefined}>
      <strong className="font-semibold">{FOUNDER_LABEL}.</strong> {FOUNDER_TOOLTIP}
    </span>
  )
  const hover = { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }
  if (plain) {
    return (
      <span className="founder-badge" {...hover}>
        <span className="founder-badge-mark">
          <AwardIcon size={size} />
          {/* The brackets keep a screen reader's "Chi, Founder, followed you" from running together. */}
          <span className="sr-only">({FOUNDER_LABEL})</span>
        </span>
        {tip}
      </span>
    )
  }
  return (
    <span className="founder-badge" {...hover}>
      <Link
        prefetch={false}
        href="/about#about-origin"
        className="founder-badge-mark is-link"
        aria-describedby={tipId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <AwardIcon size={size} />
        <span className="sr-only">{FOUNDER_LABEL}</span>
      </Link>
      {tip}
    </span>
  )
}
