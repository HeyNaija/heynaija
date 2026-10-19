import type { Metadata } from 'next'
import Link from 'next/link'
import { FeedbackNotice, GovernanceNav } from '@/app/ui/governance'
import { PolicyPage } from '@/app/ui/policy-page'
import { CONSTITUTION_SECTIONS, LEGAL_REFERENCES } from '@/lib/constitution'
import { CONSTITUTION } from '@/lib/governance'

export const metadata: Metadata = {
  title: 'Draft nonprofit constitution',
  description: `HeyNaija CAC-facing nonprofit constitution, ${CONSTITUTION.label}. Proposed Incorporated Trustees under CAMA Part F; not adopted or incorporated.`,
}

export default function ConstitutionPage() {
  return (
    <PolicyPage
      eyebrow="Governance"
      title="HeyNaija nonprofit constitution"
      summary="The proposed legal constitution for Incorporated Trustees: membership, three founding trustees, two community representatives, formal meetings, elections and nonprofit asset protections. The community charter explains the broader public commitments."
      version={CONSTITUTION.label}
      updated={CONSTITUTION.updated}
      numbered={false}
      header={<GovernanceNav />}
      notice={
        <div className="notice policy-draft constitution-status" role="note">
          <p><strong>DRAFT.</strong> {CONSTITUTION.status}</p>
          <p className="mt-2">HeyNaija is founder-operated and is not claimed incorporated or legally community-owned.
            The entire CAC-facing constitution must be reviewed by qualified Nigerian nonprofit counsel before adoption
            and registration, including every provision in Annex B. No feature is activated by this proposal.</p>
        </div>
      }
      sections={[
        ...CONSTITUTION_SECTIONS.map((section) => ({
          id: section.id,
          title: section.title,
          body: <ol>{section.clauses.map((clause) => <li key={clause}>{clause}</li>)}</ol>,
        })),
        {
          id: 'references', title: 'Primary references and related documents',
          body: <>
            <p>Legal sources checked on 19 October 2026. Counsel must confirm amendments, current CAC practice and
              requirements before filing; these references do not constitute legal approval.</p>
            <ul>{LEGAL_REFERENCES.map((source) => <li key={source.url}><a href={source.url} rel="noreferrer">{source.title}</a></li>)}</ul>
            <p>Read the <Link href="/charter">Community Governance Charter</Link>,{' '}
              <Link href="/governance/membership">membership rules</Link>,{' '}
              <Link href="/governance/verification">verification safeguards</Link> and{' '}
              <Link href="/governance#ownership">transition roadmap</Link>. The legal constitution prevails once lawfully registered;
              community policies cannot override it or the law.</p>
          </>,
        },
        {
          id: 'version-history', title: 'Version history and feedback',
          body: <>
            <ul className="constitution-versions">{CONSTITUTION.changelog.map((entry) => (
              <li key={entry.version}><strong>v{entry.version}</strong>, {entry.date}: {entry.summary}</li>
            ))}</ul>
            <p>The previous v0.2 text is preserved in the repository governance history. These proposed changes remain
              subject to consultation, Nigerian legal review and lawful adoption. They do not change current account access.</p>
            <FeedbackNotice />
          </>,
        },
      ]}
    />
  )
}
