'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

/** "Report a problem", carrying the page the reader is on, which the report keeps privately. */
export function ProblemLink({ className, children }: { className?: string; children: ReactNode }) {
  const router = useRouter()
  return (
    <Link
      href="/ideas/new?kind=problem"
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        const here = window.location.pathname + window.location.search
        router.push(`/ideas/new?kind=problem&from=${encodeURIComponent(here)}`)
      }}
    >
      {children}
    </Link>
  )
}
