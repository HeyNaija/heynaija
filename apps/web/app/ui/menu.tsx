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
  panelClassName = '',
}: {
  /** Read out by screen readers; the trigger itself is usually just an icon. */
  label: string
  trigger: ReactNode
  triggerClassName?: string
  children: ReactNode
  className?: string
  panelClassName?: string
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The same menu can sit at either edge, or wrap onto a new profile row.
    // Measure its natural alignment, then keep it inside the visible viewport.
    const position = () => {
      if (!ref.current?.open || !panel.current) return
      panel.current.style.translate = 'none'
      const bounds = panel.current.getBoundingClientRect()
      const trigger = ref.current.querySelector('summary')!.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = (viewport?.offsetLeft ?? 0) + 12
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? document.documentElement.clientWidth) - 12
      const top = (viewport?.offsetTop ?? 0) + 12
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 12
      const x = Math.max(left - bounds.left, Math.min(0, right - bounds.right))
      const y = bounds.bottom > bottom
        ? Math.max(top, trigger.top - bounds.height - 6) - bounds.top
        : Math.max(0, top - bounds.top)
      panel.current.style.translate = `${x}px ${y}px`
    }
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
    const details = ref.current
    details?.addEventListener('toggle', position)
    window.addEventListener('resize', position)
    window.visualViewport?.addEventListener('resize', position)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      details?.removeEventListener('toggle', position)
      window.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('resize', position)
    }
  }, [])

  return (
    <details ref={ref} className={`dropdown-menu relative ${className}`}>
      <summary className={`menu ${triggerClassName}`} aria-label={label}>
        {trigger}
      </summary>
      {/* Following a link inside closes the menu; form buttons re-render the page anyway. */}
      <div
        ref={panel}
        className={`menu-panel ${panelClassName}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a')) ref.current?.removeAttribute('open')
        }}
      >
        {children}
      </div>
    </details>
  )
}
