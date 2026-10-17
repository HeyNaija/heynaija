'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { PlusIcon } from './icons'

/**
 * The bottom bar's "New post". On the home feed it focuses the composer inside the
 * tap itself, which is what makes phones open the keyboard; elsewhere it goes home
 * and the composer takes focus when it arrives.
 */
export function NewPostLink({ expanded = false }: { expanded?: boolean }) {
  return (
    <ComposeLink
      href="/#compose"
      label="New post"
      className={expanded ? 'btn btn-primary btn-block sidebar-compose' : 'mobile-compose'}
    >
      <PlusIcon size={expanded ? 19 : 24} />
      {expanded ? 'Create a post' : null}
    </ComposeLink>
  )
}

/** Focus inside the tap so mobile keyboards also open for replies on the current thread. */
export function ComposeLink({ href, label, className, children, prefetch }: { href: string; label: string; className: string; children: ReactNode; prefetch?: boolean }) {
  const pathname = usePathname()
  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-label={label}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        const box = pathname === href.split('#')[0] ? document.querySelector<HTMLTextAreaElement>('#compose textarea') : null
        if (!box) return
        e.preventDefault()
        box.focus({ preventScroll: true })
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        box.closest('form')?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
      }}
      className={className}
    >
      {children}
    </Link>
  )
}
