import type { Metadata } from 'next'
import Link from 'next/link'
import { FeedbackNotice, FoundingStageNotice, GovernanceNav, MilestoneStatusChip, ProposedChip } from '@/app/ui/governance'
import {
  ArrowUpRightIcon,
  ChevronIcon,
  DocumentIcon,
  GovernanceIcon,
  HistoryIcon,
  OwnershipIcon,
  PeopleIcon,
  ShieldIcon,
  TreasuryIcon,
  VoteIcon,
} from '@/app/ui/icons'
import { CONSTITUTION, MINIMUM_ELECTORATE, OWNERSHIP_MILESTONES, PROPOSAL_RULES, PROPOSED_THRESHOLDS, TRANSITION_EXPLANATION } from '@/lib/governance'

export const metadata: Metadata = {
  title: 'Governance',
  description:
    'How HeyNaija is run today, how it proposes to become community-owned, and what is and is not live yet.',
}

const sections = [
  { id: 'structure', label: 'How it would work' },
  { id: 'participation', label: 'Ways to take part' },
  { id: 'votes', label: 'Community votes' },
  { id: 'ownership', label: 'Path to ownership' },
  { id: 'treasury', label: 'Public Treasury' },
  { id: 'decisions', label: 'Decision history' },
  { id: 'documents', label: 'Charter and policies' },
]

export default function GovernancePage() {
  return (
    <div className="governance-page">
      <header className="governance-header">
        <p className="governance-eyebrow"><GovernanceIcon size={17} /> Governance</p>
        <h1 className="mt-3 page-title governance-title">A social network shaped by its community.</h1>
        <p className="governance-lead">
          HeyNaija is being built so that the people who use it can, in time, own and run it. This page explains
          who runs it today, how members would make decisions, and what has to happen before any of that is real.
        </p>
        <GovernanceNav />
      </header>

      <FoundingStageNotice />

      <section className="governance-summary" aria-labelledby="summary-heading">
        <div className="governance-section-heading">
          <h2 id="summary-heading" className="section-title">The 30-second version</h2>
          <ProposedChip>Proposed, not yet in effect</ProposedChip>
        </div>
        <p className="governance-summary-text">
          Post without NIN. Legal association membership would be a separate admission. Every eligible adult legal
          member could voluntarily activate an equal governance vote after verification. Proposed registration:
          Incorporated Trustees under Part F of CAMA 2020, with no private shareholders or profit distributions.
        </p>
        <p className="governance-copy">Proposed, subject to lawful adoption and Nigerian legal review: {TRANSITION_EXPLANATION}</p>
        <div className="governance-actions">
          <Link href="/governance/constitution" className="btn btn-primary">Read the draft constitution</Link>
          <Link href="/governance/verification" className="btn btn-secondary">How verification would work</Link>
          <Link href="/charter" className="btn btn-secondary">Read the charter</Link>
        </div>
        <FeedbackNotice />
      </section>

      <nav aria-label="On this page" className="governance-jump-links">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`}>{s.label}</a>
        ))}
      </nav>

      <section id="structure" className="governance-section" aria-labelledby="structure-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><GovernanceIcon size={22} /></span>
          <h2 id="structure-heading" className="section-title">How HeyNaija would be governed</h2>
          <ProposedChip />
        </div>
        <p className="governance-copy">
          The proposed Council has three registered trustees plus two community representatives. After incorporation,
          the three founding trustees would form the initial body; two representatives join after readiness and elections.
          Today the founders run HeyNaija and these proposed bodies are not claimed operational.
        </p>
        <ol className="gov-flow" aria-label="Proposed structure, from members to the teams that run HeyNaija">
          <li className="gov-flow-tier">
            <div className="gov-flow-node is-root">
              <p className="gov-flow-name">Voting members</p>
              <p className="gov-flow-role">Eligible legal members who verified adult identity and voluntarily activated platform voting. One person, one vote.</p>
            </div>
          </li>
          <li className="gov-flow-tier">
            <span className="gov-flow-arrow" aria-hidden="true"><ChevronIcon size={18} /></span>
            <div className="gov-flow-node">
              <p className="gov-flow-name">Community Council</p>
              <p className="gov-flow-role">Three registered trustees on a common three-year cycle, plus two annually elected representatives. Oversees budgets, leads, roadmap and risk.</p>
            </div>
          </li>
          <li className="gov-flow-tier">
            <span className="gov-flow-arrow" aria-hidden="true"><ChevronIcon size={18} /></span>
            <ul className="gov-flow-teams">
              <li className="gov-flow-node">
                <p className="gov-flow-name">Operations</p>
                <p className="gov-flow-role">Keeps the service running, secure and within budget.</p>
              </li>
              <li className="gov-flow-node">
                <p className="gov-flow-name">Development</p>
                <p className="gov-flow-role">Releases, architecture and security patches, in the open.</p>
              </li>
              <li className="gov-flow-node">
                <p className="gov-flow-name">Moderation</p>
                <p className="gov-flow-role">Applies the published rules to reports, with appeals.</p>
              </li>
            </ul>
          </li>
        </ol>
        <p className="governance-copy">
          Proposed quorum: two for the initial three-trustee body; three for the full five-member Council. Routine
          decisions use a majority of non-conflicted members present; ties fail. Representatives participate in
          oversight but do not gain statutory trustee powers. Trustee changes require lawful association resolutions
          and applicable CAC approval. The founding term counts toward the retained limit of two consecutive full
          terms per role, followed by a one-term break.
        </p>
        <div className="governance-callout">
          <p className="flex items-center gap-2 text-sm font-semibold"><ShieldIcon size={17} /> Moderation stays independent</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Decisions about individual posts and accounts are made by moderators under the published{' '}
            <Link href="/rules">rules</Link>, with appeals, today and under the draft. The draft adds independent
            reviewers for appeals where possible, and says no public vote may decide a person’s ban, a post’s removal,
            a private account record or anyone’s identity status. In an emergency, operators could act at once to
            protect safety, privacy or the service, but would have to record why and put it to review within seven
            days where safe and lawful.
          </p>
        </div>
      </section>

      <section id="participation" className="governance-section" aria-labelledby="participation-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><PeopleIcon size={22} /></span>
          <h2 id="participation-heading" className="section-title">Three ways to take part</h2>
        </div>
        <p className="governance-copy">
          Platform users, legal members and active voting members are distinct. Identity verification and public
          badges are separate from all three. An account, verification or online opt-in alone does not admit anyone
          to the association. You never need NIN verification for ordinary social activity.
        </p>
        <p className="governance-copy">
          Accounts are 18+ only while the beta runs. HeyNaija intends to open them to younger people once child-safety
          protections, age checks and any parental consent the law requires are approved; voting membership would
          stay 18+, with a verified age.
        </p>
        <ul className="participation-list">
          <li className="participation-card">
            <div className="participation-head">
              <span className="participation-icon"><PeopleIcon size={18} /></span>
              <h3 className="participation-name">Platform user</h3>
            </div>
            <p className="participation-status">Available now, by invite</p>
            <dl className="participation-facts">
              <div><dt>What you can do</dt><dd>Post, reply, follow, join communities, report and appeal.</dd></div>
              <div><dt>What it needs</dt><dd>An invite and, during the beta only, being 18 or older. No NIN.</dd></div>
              <div><dt>Votes</dt><dd>No governance vote.</dd></div>
            </dl>
          </li>
          <li className="participation-card">
            <div className="participation-head">
              <span className="participation-icon"><PeopleIcon size={18} /></span>
              <h3 className="participation-name">Legal member</h3>
            </div>
            <p className="participation-status">Formal association admission is proposed; not open in the platform.</p>
            <dl className="participation-facts">
              <div><dt>What it adds</dt><dd>Rights under the association’s registered constitution, including formal meeting rights.</dd></div>
              <div><dt>What it needs</dt><dd>Documented admission under transparent, consistently applied constitutional rules.</dd></div>
              <div><dt>Choice</dt><dd>Every eligible legal member may activate platform voting voluntarily. Opting out does not end legal membership or formal meeting rights.</dd></div>
            </dl>
            <Link href="/governance/membership" className="participation-link">Legal and voting membership <ArrowUpRightIcon size={15} /></Link>
          </li>
          <li className="participation-card">
            <div className="participation-head">
              <span className="participation-icon"><VoteIcon size={18} /></span>
              <h3 className="participation-name">Active voting member</h3>
            </div>
            <p className="participation-status">Registration has not opened.</p>
            <dl className="participation-facts">
              <div><dt>What it adds</dt><dd>One vote in member decisions and council elections; the right to propose, nominate and stand.</dd></div>
              <div><dt>What it needs</dt><dd>Legal admission, verified adult identity (NIN initially preferred), voluntary activation and published eligibility deadlines. Future lawful verification alternatives are permitted.</dd></div>
              <div><dt>Cost</dt><dd>Proposed to be free. Payments and donations never buy votes.</dd></div>
            </dl>
            <Link href="/governance/membership" className="participation-link">Voting membership in full <ArrowUpRightIcon size={15} /></Link>
          </li>
        </ul>
      </section>

      <section id="votes" className="governance-section" aria-labelledby="votes-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><VoteIcon size={22} /></span>
          <h2 id="votes-heading" className="section-title">Community votes</h2>
          <span className="chip">Not live</span>
        </div>

        <div className="vote-scope">
          <div>
            <h3 className="governance-subtitle">Members would vote on</h3>
            <ul className="governance-list">
              <li>Electing and recalling three trustees on their three-year cycle and two representatives annually</li>
              <li>Adopting and changing the constitution</li>
              <li>Major policy questions and changes to HeyNaija’s mission</li>
              <li>Selling, permanently transferring or dissolving core assets, or changing who controls them</li>
            </ul>
          </div>
          <div>
            <h3 className="governance-subtitle">Members would not vote on</h3>
            <ul className="governance-list">
              <li>Whether a particular person is banned or suspended</li>
              <li>Private reports or individual account records</li>
              <li>Moderation of particular posts</li>
              <li>Details of security fixes before they are safe to share</li>
            </ul>
          </div>
        </div>

        <p className="governance-copy">
          Platform ballots and formal association meetings are distinct. Legal members keep lawful meeting rights
          even if they opt out online. Recall has independent oversight, notice and a fair hearing; no founder
          permission is needed. A trustee ballot requires legal follow-through, not an automatic appointment or removal.
        </p>
        <h3 className="governance-subtitle mt-6">How a proposal would work</h3>
        <ol className="proposal-steps">
          <li><span className="proposal-step-name">Publish</span><span>A voting member publishes the purpose, exact text, alternatives, costs and risks. It needs {PROPOSAL_RULES.endorsements} to reach a ballot.</span></li>
          <li><span className="proposal-step-name">{PROPOSAL_RULES.consultationDays}-day consultation</span><span>Everyone can read and discuss it before any vote.</span></li>
          <li><span className="proposal-step-name">Eligibility lock and notice</span><span>The list of who can vote is fixed {PROPOSAL_RULES.eligibilityFreezeDays} days before the ballot opens, and the ballot is announced.</span></li>
          <li><span className="proposal-step-name">{PROPOSAL_RULES.ballotDays}-day ballot</span><span>A private, independently auditable vote: one ballot per member, with no record linking a person to their choice.</span></li>
          <li><span className="proposal-step-name">Result and follow-through</span><span>Totals and the audit outcome are published, and what was done about it goes into the decision history.</span></li>
        </ol>

        <details className="governance-disclosure">
          <summary className="menu">Proposed thresholds, awaiting community and legal approval <ChevronIcon size={16} /></summary>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            These are platform ballot thresholds from the draft constitution, not yet in force; formal association meetings have separate rules. If turnout falls short, nothing
            passes: the discussion reopens and the ballot is rerun, without lowering the bar.
          </p>
          <div className="threshold-table-wrap">
            <table className="threshold-table">
              <caption className="sr-only">Proposed approval and turnout thresholds</caption>
              <thead>
                <tr><th scope="col">Decision</th><th scope="col">To pass</th><th scope="col">Minimum turnout</th></tr>
              </thead>
              <tbody>
                {PROPOSED_THRESHOLDS.map((row) => (
                  <tr key={row.decision}>
                    <th scope="row">{row.decision}</th>
                    <td>{row.approval}</td>
                    <td>{row.turnout}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <div className="vote-records">
          <div className="governance-empty">
            <p className="text-sm font-semibold">Proposals</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              No proposals have been submitted. Proposals need voting members, and voting membership has not opened.
            </p>
          </div>
          <div className="governance-empty">
            <p className="text-sm font-semibold">Elections</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              There is no Community Council yet and no election has been scheduled. Under the draft, no binding vote
              can open until at least {MINIMUM_ELECTORATE} verified adult legal members have activated voting and
              independent voting controls have been tested.
            </p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Any early poll before then would be labelled <strong className="text-ink">non-binding</strong>.
        </p>
      </section>

      <section id="ownership" className="governance-section" aria-labelledby="ownership-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><OwnershipIcon size={22} /></span>
          <h2 id="ownership-heading" className="section-title">Path to community ownership</h2>
        </div>
        <p className="governance-copy">
          HeyNaija is not community-owned today. These are the steps the draft constitution proposes, with where
          each one actually stands. Actual dates depend on incorporation and legal review. Prepare the first trustee
          election 180 days before founding-term expiry and publish its timetable by 90 days before expiry. If online
          governance is delayed, the draft requires lawful formal member procedures; any caretaker authority needs a
          legal basis and member approval, lasts at most 90 days and cannot automatically renew founder control.
        </p>
        <ol className="milestone-list">
          {OWNERSHIP_MILESTONES.map((m, i) => (
            <li key={m.id} className="milestone">
              <span className="milestone-number" aria-hidden="true">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="milestone-head">
                  <h3 className="milestone-title">{m.title}</h3>
                  <MilestoneStatusChip status={m.status} />
                </div>
                <p className="milestone-detail">{m.detail}</p>
                {m.evidence ? <a href={m.evidence} className="milestone-evidence">See the evidence</a> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="treasury" className="governance-section" aria-labelledby="treasury-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><TreasuryIcon size={22} /></span>
          <h2 id="treasury-heading" className="section-title">Public Treasury</h2>
          <span className="chip">Not live</span>
        </div>
        <p className="governance-copy">
          An open view of HeyNaija’s own funds: what comes in, what goes out, and the decisions behind each
          allocation. Lawful donations, grants, voluntary contributions, permitted subscriptions, platform revenue
          and sponsorships could fund the nonprofit objects, without buying votes or control. No profits may be
          distributed privately. The proposed bank mandate requires multiple signatories and two approvals.
        </p>
        <dl className="treasury-plan">
          <div><dt>Funds received</dt><dd>Where support comes from, and any material sponsorship terms</dd></div>
          <div><dt>Spending and allocations</dt><dd>Actual approved spending; any founder or councillor payment needs conflict controls and compliance with CAMA section 838’s paid-office restrictions, reviewed by Nigerian counsel</dd></div>
          <div><dt>Reports</dt><dd>Independently reviewed summaries, at least quarterly once money flows</dd></div>
        </dl>
        <div className="governance-empty">
          <p className="text-sm font-semibold">No treasury records</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            There is no public treasury yet, so there is no balance or transaction to show. HeyNaija is not collecting
            money from members, and this page will never show estimated or sample figures. This covers HeyNaija’s funds,
            not government finances.
          </p>
        </div>
      </section>

      <section id="decisions" className="governance-section" aria-labelledby="decisions-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><HistoryIcon size={22} /></span>
          <h2 id="decisions-heading" className="section-title">Decision history</h2>
        </div>
        <p className="governance-copy">
          A public record of governance decisions: what was decided, by whom, and what happened next. Moderation
          cases, identity details, ballots and personal data never appear here.
        </p>
        <div className="governance-empty">
          <p className="text-sm font-semibold">No decisions recorded yet</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            No community vote has been held and no governance decision has been published. Changes to the drafts are
            listed in each document’s version history, starting with the{' '}
            <Link href="/governance/constitution#version-history" className="font-semibold text-accent-strong hover:underline">
              constitution’s
            </Link>.
          </p>
        </div>
      </section>

      <section id="documents" className="governance-section" aria-labelledby="documents-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><DocumentIcon size={22} /></span>
          <h2 id="documents-heading" className="section-title">Charter and policies</h2>
          <span className="chip">Drafts</span>
        </div>
        <p className="governance-copy">
          The rules, privacy policy and charter apply today. The constitution is a proposal for how HeyNaija would be
          governed, and does not apply until it is lawfully adopted.
        </p>
        <ul className="governance-documents">
          <li><Link href="/charter">Community Governance Charter</Link><span>Current promises and proposed public governance, separate from the CAC legal constitution.</span></li>
          <li><Link href="/rules">Rules</Link><span>How we treat each other, and what moderators do. In force during the pilot.</span></li>
          <li><Link href="/privacy">Privacy policy</Link><span>What we collect, what is public, and your rights. In force during the pilot.</span></li>
          <li><Link href="/governance/constitution">Draft constitution</Link><span>{CONSTITUTION.label}: the proposed rules for membership, votes, the council and ownership. Not adopted.</span></li>
          <li><Link href="/licence">Licence</Link><span>The code is open source under the AGPL.</span></li>
        </ul>
      </section>

      <footer className="governance-footer">
        <nav aria-label="About and product progress" className="policy-links">
          <Link href="/about">Why HeyNaija exists</Link>
          <Link href="/progress">Product roadmap and progress</Link>
        </nav>
        <p className="text-sm text-muted">The conversation starts with the community.</p>
        <Link href="/c" className="btn btn-secondary btn-sm mt-3">Explore communities</Link>
      </footer>
    </div>
  )
}
