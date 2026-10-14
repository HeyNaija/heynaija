'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** A navigation link that knows whether it points at the current page. */
export function NavLink({
  href,
  exact = false,
  className,
  activeClassName = '',
  children,
  label,
}: {
  href: string
  /** Match only this exact path (used for Home, which is a prefix of everything). */
  exact?: boolean
  className: string
  /** Extra classes when active. Styling off [aria-current="page"] in CSS also works. */
  activeClassName?: string
  children: ReactNode
  label?: string
}) {
  const pathname = usePathname()
  const path = href.split(/[?#]/)[0]!
  const active = exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`${className} ${active ? activeClassName : ''}`}
    >
      {children}
    </Link>
  )
}
