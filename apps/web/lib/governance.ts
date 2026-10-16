// Facts about HeyNaija's governance that more than one page states. Change them
// here, and only when they become true: the pages must never claim more
// community control than exists (PRODUCT.md, "Truthful about ownership").
//
// Nothing here switches a feature on. Identity verification, voting membership
// and binding votes are refused by the API whatever this file says (see
// apps/api/src/env.ts and docs/governance/open-items.md).

/** The draft constitution published at /governance/constitution. */
export const CONSTITUTION = {
  version: '0.2',
  label: 'Draft v0.2',
  updated: '16 October 2026',
  status: 'Proposed for public consultation. Not yet adopted or legally operative.',
  changelog: [
    { version: '0.2', date: '16 October 2026', summary: 'First version published on HeyNaija, for public consultation.' },
  ],
} as const

export type MilestoneStatus = 'not-started' | 'in-progress' | 'completed'

export type Milestone = {
  id: string
  title: string
  detail: string
  status: MilestoneStatus
  /**
   * Required before a milestone may be marked completed: a public link to the
   * proof (a published document, a registration record, an independent report).
   */
  evidence?: string
}

/**
 * The path to community ownership, in the order the draft constitution proposes
 * (Article 13.2). Statuses describe what has actually happened, and nothing has
 * a date because no date has been set: Article 13.5 says the timetable comes
 * after the legal feasibility review.
 */
export const OWNERSHIP_MILESTONES: Milestone[] = [
  {
    id: 'drafts',
    title: 'Publish the drafts and who runs HeyNaija',
    detail:
      'The draft constitution, charter, rules and privacy policy are published. The operator’s legal name, the founding custodians and a privacy contact are not published yet.',
    status: 'in-progress',
  },
  {
    id: 'consultation',
    title: 'Public consultation and a temporary advisory group',
    detail: 'A working way to send feedback on the drafts, and a published advisory group with terms of reference.',
    status: 'not-started',
  },
  {
    id: 'legal-review',
    title: 'Legal and privacy review',
    detail: 'Nigerian cooperative, corporate and data-protection counsel review the drafts, and a privacy impact assessment covers identity checks.',
    status: 'not-started',
  },
  {
    id: 'entity',
    title: 'Register a member-controlled Nigerian legal entity',
    detail: 'Choose and register a suitable structure, such as a cooperative, that members can legally control.',
    status: 'not-started',
  },
  {
    id: 'first-election',
    title: 'Adopt membership bylaws and hold the first election',
    detail: 'Open voting membership, adopt lawful bylaws, and elect the first five-member Community Council.',
    status: 'not-started',
  },
  {
    id: 'transfer',
    title: 'Transfer the domain, brand and core assets',
    detail: 'Move the domain, name and wordmark, operational assets, code rights and governance control to the member-controlled entity, by signed documents.',
    status: 'not-started',
  },
  {
    id: 'proof',
    title: 'Publish independent confirmation',
    detail: 'An independent party confirms the transfer, and the proof is published here.',
    status: 'not-started',
  },
]

export const MILESTONE_LABEL: Record<MilestoneStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  completed: 'Completed',
}

/**
 * Proposed decision rules from the draft constitution (Articles 8 and 9). None of
 * them is in force: no binding vote can be held yet.
 */
export const PROPOSED_THRESHOLDS = [
  {
    decision: 'Ordinary member decisions',
    approval: 'More than half of valid votes',
    turnout: 'At least 25 voters or 10% of eligible members, whichever is greater',
  },
  {
    decision: 'Constitutional amendments',
    approval: 'At least two-thirds of valid votes',
    turnout: 'At least 50 voters or 20% of eligible members, whichever is greater',
  },
  {
    decision: 'Sale, dissolution or permanent transfer of core assets',
    approval: 'At least 75% of valid votes, plus every required legal approval',
    turnout: 'At least 50 voters or 25% of eligible members, whichever is greater',
  },
  {
    decision: 'Community Council elections',
    approval: 'The five most-supported eligible candidates; a runoff settles ties',
    turnout: 'At least 25 voters or 10% of eligible members, whichever is greater',
  },
  {
    decision: 'Recalling a council member',
    approval: 'More than half of valid votes, after a petition by 10% of eligible members',
    turnout: 'The same as an ordinary decision',
  },
] as const

/** Draft constitution, Article 8.10. */
export const MINIMUM_ELECTORATE = 100

/** Draft constitution, Articles 8.2 and 8.3, and 5.5. */
export const PROPOSAL_RULES = {
  endorsements: '10 voting members or 2% of eligible voters, whichever is greater, capped at 100; or referral by three council members',
  consultationDays: 14,
  ballotDays: 7,
  eligibilityFreezeDays: 14,
  accountAgeDays: 30,
} as const
