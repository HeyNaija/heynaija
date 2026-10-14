'use client'

import { BubbleIcon } from '@/app/ui/icons'

// Shown when a page cannot load its data, e.g. the API is down or unreachable.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="state-page">
      <span className="empty-state-icon mx-auto mb-5"><BubbleIcon size={24} /></span>
      <p className="page-eyebrow mb-3">Let’s try that again</p>
      <h1 className="page-title">We could not load this page</h1>
      <p className="mt-2 text-sm text-muted">Check your connection and try again.</p>
      <button
        type="button"
        onClick={reset}
        className="btn btn-primary mt-6"
      >
        Try again
      </button>
    </div>
  )
}
