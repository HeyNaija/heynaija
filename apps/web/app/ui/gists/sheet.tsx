'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { CloseIcon } from '@/app/ui/icons'

/**
 * A bottom sheet on phones and a centred card on desktop, on the native <dialog>:
 * the browser traps focus inside, closes on Esc, and puts focus back on the button
 * that opened it. The content is not rendered while it is closed.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="gist-sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      // A tap on the dimmed area outside the card closes it.
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      {open ? (
        <div className="gist-sheet-body">
          <div className="gist-sheet-head">
            <h2 id={titleId} className="section-title">
              {title}
            </h2>
            <button type="button" className="icon-btn gist-sheet-close" aria-label={`Close ${title}`} onClick={onClose}>
              <CloseIcon size={20} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
