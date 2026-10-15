import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronIcon, GovernanceIcon, HistoryIcon, TreasuryIcon, VoteIcon } from '@/app/ui/icons'

export const metadata: Metadata = { title: 'Governance' }

export default function GovernancePage() {
  return (
    <div className="governance-page">
      <header className="governance-header">
        <p className="governance-eyebrow"><GovernanceIcon size={17} /> Our shared future</p>
        <h1 className="mt-3 page-title">Governance</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          A stronger community starts with a voice in how it’s run. This is where we’re building
          toward shared decisions and open books for HeyNaija.
        </p>
        <nav aria-label="On this page" className="governance-jump-links">
          <a href="#documents">Charter and policies</a>
          <a href="#votes">Community votes</a>
          <a href="#treasury">Public Treasury</a>
          <a href="#decisions">Decision history</a>
        </nav>
      </header>

      <p className="governance-intro">
        <span className="font-semibold text-ink">We’re at the beginning.</span> Community voting
        and the public treasury are not live yet. The charter and policies below are drafts, published
        for the pilot before legal review; voting rules come later.
      </p>

      <section id="documents" className="governance-section" aria-labelledby="documents-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><GovernanceIcon size={22} /></span>
          <h2 id="documents-heading" className="section-title">Charter and policies</h2>
          <span className="chip">Drafts</span>
        </div>
        <ul className="governance-documents">
          <li><Link href="/charter">Charter</Link><span>What HeyNaija is for, who runs it today, and the path to community ownership.</span></li>
          <li><Link href="/rules">Rules</Link><span>How we treat each other, and what moderators do.</span></li>
          <li><Link href="/privacy">Privacy policy</Link><span>What we collect, what is public, and your rights.</span></li>
          <li><Link href="/licence">Licence</Link><span>The code is open source under the AGPL.</span></li>
        </ul>
      </section>

      <section id="votes" className="governance-section" aria-labelledby="votes-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><VoteIcon size={22} /></span>
          <h2 id="votes-heading" className="section-title">Community votes</h2>
          <span className="chip">Coming soon</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Discuss proposals and help shape major platform decisions, from community priorities to
          how moderation works.
        </p>
        <div className="governance-empty">
          <p className="text-sm font-semibold">No open votes yet</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Proposals, participation rules, and voting dates will appear here when community voting launches.
          </p>
        </div>
        <details className="governance-disclosure">
          <summary className="menu">How voting is intended to work <ChevronIcon size={16} /></summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>Read a proposal explaining the change and its trade-offs.</li>
            <li>Discuss it with other members before voting opens.</li>
            <li>Vote under published eligibility and decision rules.</li>
            <li>Follow the result and any action taken in the decision history.</li>
          </ol>
        </details>
      </section>

      <section id="treasury" className="governance-section" aria-labelledby="treasury-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><TreasuryIcon size={22} /></span>
          <h2 id="treasury-heading" className="section-title">Public Treasury</h2>
          <span className="chip">Coming soon</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          An open view of HeyNaija’s community funds: what comes in, what goes out, and the decisions
          behind each allocation.
        </p>
        <dl className="treasury-plan">
          <div><dt>Funds received</dt><dd>Where support comes from</dd></div>
          <div><dt>Spending & allocations</dt><dd>What community funds pay for</dd></div>
          <div><dt>Reports & records</dt><dd>The context behind the numbers</dd></div>
        </dl>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          This will cover HeyNaija’s funds, not government finances. No treasury balance or
          transactions are published here yet, and contributions are not being collected through this page.
        </p>
      </section>

      <section id="decisions" className="governance-section" aria-labelledby="decisions-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><HistoryIcon size={22} /></span>
          <h2 id="decisions-heading" className="section-title">Decision history</h2>
          <span className="chip">Coming soon</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          A public record of governance decisions, their outcomes, and what happens next.
          There are no published governance decisions here yet.
        </p>
      </section>

      <footer className="governance-footer">
        <p className="text-sm text-muted">The conversation starts with the community.</p>
        <Link href="/c" className="btn btn-secondary btn-sm mt-3">Explore communities</Link>
      </footer>
    </div>
  )
}
