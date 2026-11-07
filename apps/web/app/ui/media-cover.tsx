'use client'

import { type ReactNode, useState } from 'react'
import { SensitiveIcon } from './icons'

/**
 * The pictures or video of a post marked sensitive (ADR 0020), blurred behind one
 * quiet line until the reader taps Show, the way X covers sensitive media. Only
 * adults are ever sent such a post; the API says when to cover it (`coverMedia`),
 * which is never for their own posts or once they choose in Settings to see such
 * media straight away. The post's text is never covered.
 */
export function MediaCover({ covered, children }: { covered: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  if (!covered || shown) return children
  return (
    <div className="media-cover">
      {/* Out of reach until shown: nothing under the blur can be focused or opened. */}
      <div className="media-cover-content" inert>
        {children}
      </div>
      <div className="media-cover-veil">
        <p className="media-cover-label">
          <SensitiveIcon size={18} />
          <span>Sensitive content</span>
        </p>
        <button type="button" className="media-cover-show" onClick={() => setShown(true)}>
          Show
        </button>
      </div>
    </div>
  )
}
