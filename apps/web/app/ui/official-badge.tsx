'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { OfficialIcon } from './icons'

export const OFFICIAL_LABEL = 'Official HeyNaija account'
export const OFFICIAL_AUTOMATED = 'Automated: nobody signs in to it.'

/** Where "About this account" leads: Keke's own page, or the account's profile, whose bio says what it does. */
const aboutHref = (handle: string) => (handle === 'keke' || handle === 'keke_hn' ? '/about/keke' : `/u/${handle}`)

/**
 * The tick on HeyNaija's own automated accounts (Keke, The Arbiter): the API's
 * `authorAutomated` on a post, `automatedBadge` on a profile. A shield, not the
 * green identity tick, which means a person's NIN was checked. Tapping it opens
 * a small card saying it is an official, automated account, with a link to what
 * it does; Escape, a second tap or a tap elsewhere closes it. The profile also
 * says "Automated account" in words. On the account's own profile the link is
 * left out where it would only lead back to that page, as in the apps.
 */
export function OfficialBadge({ handle, size = 16, onProfile = false }: { handle: string; size?: number; onProfile?: boolean }) {
  const about = aboutHref(handle)
  const cardId = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <span className="official-badge" ref={root}>
      <button
        type="button"
        className="official-badge-mark"
        aria-expanded={open}
        aria-controls={cardId}
        onClick={(event) => {
          // Inside a post card that opens the post when clicked.
          event.preventDefault()
          event.stopPropagation()
          setOpen((was) => !was)
        }}
      >
        <OfficialIcon size={size} />
        <span className="sr-only">{OFFICIAL_LABEL}</span>
      </button>
      <span id={cardId} className="identity-badge-tip official-badge-card" data-open={open || undefined} hidden={!open}>
        <strong className="block font-semibold">{OFFICIAL_LABEL}</strong>
        <span className="block">{OFFICIAL_AUTOMATED}</span>
        {onProfile && about === `/u/${handle}` ? null : (
          <Link prefetch={false} href={about} className="mt-1 block font-semibold text-accent-strong hover:underline">
            About this account
          </Link>
        )}
      </span>
    </span>
  )
}
