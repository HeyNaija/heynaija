import Link from 'next/link'
import { ArrowUpRightIcon, TreasuryIcon } from './icons'

/** An informational preview, not a balance or an invitation to send money. */
export function TreasuryPreview() {
  return (
    <section className="rail-section rail-treasury" aria-labelledby="treasury-preview-heading">
      <p className="page-eyebrow mb-4">Our shared future</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="treasury-symbol"><TreasuryIcon size={18} /></span>
        <h2 id="treasury-preview-heading" className="section-title">Open books. Shared trust.</h2>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        We’re building toward community decisions and a transparent public treasury.
      </p>
      <span className="chip mt-3">Coming soon</span>
      <Link href="/governance#treasury" className="treasury-link">
        Explore our shared future <ArrowUpRightIcon size={16} />
      </Link>
    </section>
  )
}
