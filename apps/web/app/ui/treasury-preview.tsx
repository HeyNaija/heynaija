import Link from 'next/link'
import { ArrowUpRightIcon, TreasuryIcon } from './icons'

/** An informational preview, not a balance or an invitation to send money. */
export function TreasuryPreview() {
  return (
    <section className="treasury-preview" aria-label="Public Treasury preview">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="treasury-symbol"><TreasuryIcon size={22} /></span>
        <span className="treasury-status">Coming soon</span>
      </div>
      <h2 className="mt-4 text-lg font-bold tracking-tight">Public Treasury</h2>
      <p className="mt-2 text-[13px] leading-relaxed treasury-copy">
        Community funds. Open books. A clear view of how HeyNaija is supported and where the money goes.
      </p>
      <Link href="/governance#treasury" className="treasury-link">
        Learn about the treasury <ArrowUpRightIcon size={17} />
      </Link>
    </section>
  )
}
