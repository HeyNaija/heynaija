import { type ReactNode, Suspense } from 'react'

/** Shared frame for the account pages. The form streams in; the frame is static. */
export function AuthPage({
  title,
  intro,
  children,
  footer,
}: {
  title: string
  intro?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="mx-auto mt-6 max-w-sm">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {intro ? <p className="mt-2 text-sm text-muted">{intro}</p> : null}
      <div className="mt-6">
        <Suspense fallback={<div aria-busy="true" className="h-48 animate-pulse rounded-2xl bg-line/60" />}>
          {children}
        </Suspense>
      </div>
      {footer ? <div className="mt-6 flex flex-col gap-2 text-sm text-muted">{footer}</div> : null}
    </div>
  )
}

export const linkClass = 'text-ink underline underline-offset-2'
