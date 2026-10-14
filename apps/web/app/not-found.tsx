import Link from 'next/link'
import { SearchIcon } from '@/app/ui/icons'

export default function NotFound() {
  return (
    <div className="state-page">
      <span className="empty-state-icon mx-auto mb-5"><SearchIcon size={24} /></span>
      <p className="page-eyebrow mb-3">A small detour</p>
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
