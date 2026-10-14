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
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="text-faint">{icon}</span>
      <p className="mt-3 text-[15px] font-semibold">{title}</p>
      {children ? <p className="mt-1 max-w-xs text-sm leading-relaxed text-muted">{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
