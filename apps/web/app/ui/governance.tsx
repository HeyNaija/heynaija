import type { ReactNode } from 'react'
import { MILESTONE_LABEL, type MilestoneStatus } from '@/lib/governance'
import { DoneIcon, InProgressIcon, NotStartedIcon } from './icons'
import { NavLink } from './nav-link'

const pages = [
  { href: '/governance', label: 'Overview', exact: true },
  { href: '/governance/constitution', label: 'Draft constitution' },
  { href: '/governance/membership', label: 'Voting membership' },
  { href: '/governance/verification', label: 'Identity verification' },
]

/** Moves between the governance pages; the current one is marked for screen readers too. */
export function GovernanceNav() {
  return (
    <nav aria-label="Governance pages" className="governance-tabs">
      {pages.map((page) => (
        <NavLink key={page.href} href={page.href} exact={page.exact} className="governance-tab">
          {page.label}
        </NavLink>
      ))}
    </nav>
  )
}

/** The founding-stage notice. Every governance page carries it, word for word. */
export function FoundingStageNotice() {
  return (
    <p className="notice governance-status" role="note">
      <strong>Founding stage.</strong> HeyNaija is not legally community-owned yet. Governance proposals and
      voting rules are drafts. No binding community vote or treasury is currently live.
    </p>
  )
}

/**
 * Where feedback on the drafts would go. There is no working channel yet, so this
 * says so instead of offering a link that leads nowhere.
 */
export function FeedbackNotice() {
  return (
    <div className="governance-feedback" role="note">
      <p className="text-sm font-semibold">Share feedback</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Feedback channel being prepared. When there is a working way to comment on the drafts, it will be linked
        here and every response will be published with how it was addressed.
      </p>
    </div>
  )
}

const statusIcon: Record<MilestoneStatus, ReactNode> = {
  completed: <DoneIcon size={14} />,
  'in-progress': <InProgressIcon size={14} />,
  'not-started': <NotStartedIcon size={14} />,
}

/** A status in words with an icon beside it, so colour is never the only signal. */
export function MilestoneStatusChip({ status }: { status: MilestoneStatus }) {
  return (
    <span className={`status-chip is-${status}`}>
      {statusIcon[status]}
      {MILESTONE_LABEL[status]}
    </span>
  )
}

/** A small label saying a rule is proposed, not in force. */
export function ProposedChip({ children = 'Proposed' }: { children?: ReactNode }) {
  return <span className="status-chip is-proposed">{children}</span>
}
