import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="page-title">Nothing here</h1>
      <p className="mt-2 text-sm text-muted">
        That page does not exist, or the post or member is no longer available.
      </p>
      <Link href="/" className="btn btn-primary mt-6">
        Back to the feed
      </Link>
    </div>
  )
}
