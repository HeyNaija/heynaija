import type { ReactNode } from 'react'

/** The one way the app says "nothing here": an icon, a line, and what to do next. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <p className="mt-4 text-base font-semibold tracking-tight">{title}</p>
      {children ? <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
