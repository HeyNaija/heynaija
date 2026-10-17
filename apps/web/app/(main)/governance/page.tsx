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
  VerifiedIcon,
  VoteIcon,
} from '@/app/ui/icons'
import { CONSTITUTION, MINIMUM_ELECTORATE, OWNERSHIP_MILESTONES, PROPOSAL_RULES, PROPOSED_THRESHOLDS } from '@/lib/governance'

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
          Post without NIN. Verify optionally for a green identity tick. If you’re 18+, complete verification and
          opt into membership to vote. Members elect a council; operations and moderation remain accountable.
        </p>
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
          Under the draft constitution, authority would flow from voting members to an elected council, which
          oversees the teams that run the service day to day. Today none of these bodies exists: the founders run
          HeyNaija.
        </p>
        <ol className="gov-flow" aria-label="Proposed structure, from members to the teams that run HeyNaija">
          <li className="gov-flow-tier">
            <div className="gov-flow-node is-root">
              <p className="gov-flow-name">Voting members</p>
              <p className="gov-flow-role">Adults who verified their identity and opted in. One person, one vote.</p>
            </div>
          </li>
          <li className="gov-flow-tier">
            <span className="gov-flow-arrow" aria-hidden="true"><ChevronIcon size={18} /></span>
            <div className="gov-flow-node">
              <p className="gov-flow-name">Community Council</p>
              <p className="gov-flow-role">Five members elected for 12-month terms. Oversees budgets, leads, roadmap and risk.</p>
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
          Identity verification and voting membership are separate. Verifying does not make you a voting member,
          and you never need to verify to use HeyNaija.
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
              <h3 className="participation-name">Regular account</h3>
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
              <span className="participation-icon"><VerifiedIcon size={18} /></span>
              <h3 className="participation-name">NIN-verified account</h3>
            </div>
            <p className="participation-status">Not available yet. HeyNaija is not collecting NIN details.</p>
            <dl className="participation-facts">
              <div><dt>What it adds</dt><dd>An optional green “NIN identity verified” tick you can choose to show or hide.</dd></div>
              <div><dt>What it needs</dt><dd>Consent-based verification through an authorised NINAuth provider.</dd></div>
              <div><dt>What it does not mean</dt><dd>Not an endorsement, not proof of citizenship, and not a vote on its own.</dd></div>
            </dl>
            <Link href="/governance/verification" className="participation-link">How verification would work <ArrowUpRightIcon size={15} /></Link>
          </li>
          <li className="participation-card">
            <div className="participation-head">
              <span className="participation-icon"><VoteIcon size={18} /></span>
              <h3 className="participation-name">Voting member</h3>
            </div>
            <p className="participation-status">Registration has not opened.</p>
            <dl className="participation-facts">
              <div><dt>What it adds</dt><dd>One vote in member decisions and council elections; the right to propose, nominate and stand.</dd></div>
              <div><dt>What it needs</dt><dd>A verified age of 18 or older, NIN verification, an explicit opt-in, and the other published conditions.</dd></div>
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
              <li>Electing and recalling the Community Council</li>
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
            These numbers come from the draft constitution and are not in force. If turnout falls short, nothing
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
              can open until at least {MINIMUM_ELECTORATE} verified adults have opted into voting membership and
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
          each one actually stands. No dates are given because none has been set: a timetable will follow the legal
          review.
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
          allocation. Donations, grants and subscriptions could pay for running HeyNaija, but they would never buy
          votes or control.
        </p>
        <dl className="treasury-plan">
          <div><dt>Funds received</dt><dd>Where support comes from, and any material sponsorship terms</dd></div>
          <div><dt>Spending and allocations</dt><dd>What the money pays for, including any payments to founders or councillors</dd></div>
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
          <li><Link href="/charter">Charter</Link><span>What HeyNaija is for, the promises it keeps today, and who runs it now.</span></li>
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
