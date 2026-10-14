import { type ReactNode, Suspense } from 'react'

/** Shared frame for the account pages. The form streams in; the frame is static. */
export function AuthPage({
  title,
  intro,
  children,
  footer,
  framed = false,
}: {
  title: string
  intro?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Draw its own card (for pages inside the main shell, which has none). */
  framed?: boolean
}) {
  return (
    <div className={framed ? "square-card mx-auto max-w-md p-5 sm:p-7" : ""}>
      <h1 className="page-title">{title}</h1>
      {intro ? <p className="mt-2 text-sm leading-relaxed text-muted">{intro}</p> : null}
      <div className="mt-6">
        <Suspense fallback={<div aria-busy="true" className="skeleton h-48" />}>
          {children}
        </Suspense>
      </div>
      {footer ? <div className="mt-6 flex flex-col gap-2 text-sm text-muted">{footer}</div> : null}
    </div>
  )
}

export const linkClass = 'font-semibold text-accent-strong hover:underline'
