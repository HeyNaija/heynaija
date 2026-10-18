'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent, ReactNode } from 'react'

// Selecting copy must not open the post on release.
const selecting = (event: MouseEvent<HTMLElement>) => {
  const selection = window.getSelection()
  const card = event.currentTarget.closest('article')
  return Boolean(selection && !selection.isCollapsed && card &&
    (card.contains(selection.anchorNode) || card.contains(selection.focusNode)))
}

/**
 * A native link supplies card navigation, modifier clicks and browser link menus.
 * Text with links of its own (`beside`, for mentions) cannot sit inside it, so it
 * sits next to the link instead, labelled by `label`, and a click on its plain
 * text opens the post the same way.
 */
export function PostPermalink({
  href,
  label,
  beside = false,
  children,
}: {
  href: string
  label?: string
  beside?: boolean
  children: ReactNode
}) {
  const router = useRouter()
  // In both, the text sits above the card-wide overlay so a drag selects it.
  if (beside) {
    return (
      <>
        <Link href={href} prefetch={false} className="post-primary-link" aria-label={label} draggable={false} />
        <span
          className="post-primary-text"
          onClick={(event) => {
            // Mentions are links of their own; shift-click extends a selection.
            if (event.button !== 0 || event.shiftKey || event.altKey || (event.target as Element).closest('a')) return
            if (selecting(event)) return
            if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener')
            else router.push(href)
          }}
        >
          {children}
        </span>
      </>
    )
  }
  return (
    <Link
      href={href}
      prefetch={false}
      className="post-primary-link"
      aria-label={label}
      draggable={false}
      onClick={(event) => {
        // Keyboard activation and modifier clicks retain their normal link behavior.
        if (event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (selecting(event)) event.preventDefault()
      }}
    >
      <span className="post-primary-text">{children}</span>
    </Link>
  )
}
