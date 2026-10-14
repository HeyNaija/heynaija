'use client'

import { usePathname } from 'next/navigation'

/**
 * The unread count beside the Notifications link. Hidden on the notifications
 * page itself, which marks them read; the next page load brings the new count.
 */
export function UnreadBadge({ count, dot = false }: { count: number; dot?: boolean }) {
  const pathname = usePathname()
  if (count === 0 || pathname === '/notifications') return null
  const label = `${count} unread`
  return dot ? (
    <span className="unread-dot">
      <span className="sr-only">{label}</span>
    </span>
  ) : (
    <span className="unread-badge">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
