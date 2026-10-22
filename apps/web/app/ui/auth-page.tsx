import { type ReactNode, Suspense } from 'react'
import { linkClass } from '@/lib/auth/link-class'

export { linkClass }

/** Shared frame for the account pages. The form streams in; the frame is static. */
export function AuthPage({
  title,
  intro,
  children,
  footer,
  eyebrow,
  framed = false,
}: {
  title: string
  intro?: ReactNode
  children: ReactNode
  footer?: ReactNode
  eyebrow?: string
  /** Draw its own card (for pages inside the main shell, which has none). */
  framed?: boolean
}) {
  return (
    <div className={framed ? "square-card mx-auto max-w-md p-5 sm:p-7" : ""}>
      {eyebrow ? <p className="mb-3 text-xs font-semibold tracking-[0.1em] text-accent-strong uppercase">{eyebrow}</p> : null}
      <h1 className="page-title">{title}</h1>
      {intro ? <p className="mt-3 text-sm leading-6 text-muted">{intro}</p> : null}
      <div className="mt-7">
        <Suspense fallback={<div aria-busy="true" aria-label="Loading account form" className="flex flex-col gap-4"><div className="skeleton h-12" /><div className="skeleton h-12" /><div className="skeleton h-12" /></div>}>
          {children}
        </Suspense>
      </div>
      {footer ? <div className="mt-7 flex flex-col gap-2 border-t border-line pt-5 text-sm leading-6 text-muted">{footer}</div> : null}
    </div>
  )
}
