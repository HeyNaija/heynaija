'use client'

import { type ReactNode, useEffect, useRef } from 'react'

/**
 * A dropdown built on <details>, so it opens without JavaScript. With JavaScript
 * it also closes the way people expect: on a click elsewhere, on Escape, and
 * after choosing an item.
 */
export function Menu({
  label,
  trigger,
  triggerClassName = 'icon-btn',
  children,
  className = '',
}: {
  /** Read out by screen readers; the trigger itself is usually just an icon. */
  label: string
  trigger: ReactNode
  triggerClassName?: string
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const close = () => ref.current?.removeAttribute('open')
    const onPointer = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) {
        close()
        ref.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <details ref={ref} className={`relative ${className}`}>
      <summary className={`menu ${triggerClassName}`} aria-label={label}>
        {trigger}
      </summary>
      {/* Following a link inside closes the menu; form buttons re-render the page anyway. */}
      <div
        className="menu-panel"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) ref.current?.removeAttribute('open')
        }}
      >
        {children}
      </div>
    </details>
  )
}
