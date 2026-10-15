'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

/** A native link supplies card navigation, modifier clicks and browser link menus. */
export function PostPermalink({ href, label, children }: { href: string; label?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="post-primary-link"
      aria-label={label}
      draggable={false}
      onClick={(event) => {
        // Selecting copy must not open the post on release. Keyboard activation
        // and modifier clicks retain their normal link behavior.
        if (event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const selection = window.getSelection()
        const card = event.currentTarget.closest('article')
        if (selection && !selection.isCollapsed && card &&
          (card.contains(selection.anchorNode) || card.contains(selection.focusNode))) event.preventDefault()
      }}
    >
      {/* The text sits above the card-wide overlay so a drag selects it. */}
      <span className="post-primary-text">{children}</span>
    </Link>
  )
}
