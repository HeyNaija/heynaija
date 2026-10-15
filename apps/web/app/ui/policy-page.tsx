import Link from 'next/link'
import type { ReactNode } from 'react'

export type PolicySection = { id: string; title: string; body: ReactNode }

/**
 * A governance document: the rules, privacy policy, charter or licence. While a
 * document is a draft it says so at the top, with the date, so nobody mistakes it
 * for a reviewed commitment (PLAN.md §10: no claims before legal review).
 */
export function PolicyPage({
  eyebrow,
  title,
  summary,
  updated,
  draft = true,
  sections,
}: {
  eyebrow: string
  title: string
  summary: ReactNode
  /** Shown as "Last updated", e.g. "15 October 2026". */
  updated: string
  draft?: boolean
  sections: PolicySection[]
}) {
  return (
    <article className="policy-page">
      <header className="page-intro">
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="policy-summary">{summary}</p>
        <p className="policy-updated">Last updated {updated}</p>
      </header>

      {draft ? (
        <p className="notice policy-draft" role="note">
          <strong>Draft.</strong> Published for the invite-only pilot so you can see how HeyNaija works. It
          has not been reviewed by a lawyer yet and may change; changes will be announced on the{' '}
          <Link href="/governance" className="font-semibold underline">governance page</Link>. Text in{' '}
          <Placeholder>brackets</Placeholder> is still to be filled in.
        </p>
      ) : null}

      <nav aria-label="On this page" className="policy-contents">
        <p className="policy-contents-title">On this page</p>
        <ol>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((s) => (
        <section key={s.id} id={s.id} className="policy-section" aria-labelledby={`${s.id}-heading`}>
          <h2 id={`${s.id}-heading`} className="section-title">
            {s.title}
          </h2>
          <div className="policy-body">{s.body}</div>
        </section>
      ))}

      <footer className="policy-footer">
        <p>Governance documents</p>
        <PolicyLinks />
      </footer>
    </article>
  )
}

/** A fact the operators still have to supply. Visible on purpose. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <mark className="policy-placeholder">[{children}]</mark>
}

/** The four documents, for footers and the governance page. */
export function PolicyLinks({ className = 'policy-links' }: { className?: string }) {
  return (
    <ul className={className}>
      <li><Link href="/rules">Rules</Link></li>
      <li><Link href="/privacy">Privacy</Link></li>
      <li><Link href="/charter">Charter</Link></li>
      <li><Link href="/licence">Licence</Link></li>
    </ul>
  )
}
