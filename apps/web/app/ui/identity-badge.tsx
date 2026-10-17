'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import { VerifiedIcon } from './icons'

export const BADGE_LABEL = 'NIN identity verified'
export const BADGE_TOOLTIP = 'Identity was verified; this does not mean HeyNaija endorses this account or its posts.'

/**
 * The green identity tick. Render it only where the API says the account has a
 * live, reviewed verification and its owner chose to show it (`identityBadge` on
 * a profile); never from anything the member typed. It is a link to the
 * explainer, so a tap on a phone leads to what it means, and the tooltip appears
 * on hover and keyboard focus and closes with Escape (WCAG 1.4.13).
 *
 * `preview` draws the design on the explainer page, where it is not attached to
 * any account.
 */
export function IdentityBadge({ withLabel = false, preview = false }: { withLabel?: boolean; preview?: boolean }) {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  return (
    <span
      className="identity-badge"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link
        href="/governance/verification#green-tick"
        className="identity-badge-mark"
        aria-describedby={tipId}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <VerifiedIcon size={withLabel ? 16 : 18} />
        <span className={withLabel ? undefined : 'sr-only'}>{BADGE_LABEL}</span>
        {preview ? <span className="sr-only"> (design preview, not attached to any account)</span> : null}
      </Link>
      <span role="tooltip" id={tipId} className="identity-badge-tip" data-open={open || undefined}>
        {BADGE_TOOLTIP}
      </span>
    </span>
  )
}
