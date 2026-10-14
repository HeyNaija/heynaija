'use client'

// Shown when a page cannot load its data, e.g. the API is down or unreachable.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-16 text-center">
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
