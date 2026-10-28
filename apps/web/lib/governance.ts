// Facts about HeyNaija's governance that more than one page states. Change them
// here, and only when they become true: the pages must never claim more
// community control than exists (PRODUCT.md, "Truthful about ownership").
//
// Nothing here switches a feature on. Identity verification, voting membership
// and binding votes are refused by the API whatever this file says (see
// apps/api/src/env.ts and docs/governance/open-items.md).

/** The draft constitution published at /governance/constitution. */
export const CONSTITUTION = {
  version: '0.3.1',
  label: 'Draft v0.3.1',
  updated: '28 October 2026',
  status: 'Proposed for public consultation. Not yet adopted or legally operative.',
  changelog: [
    { version: '0.2', date: '16 October 2026', summary: 'First version published on HeyNaija, for public consultation.' },
    { version: '0.3', date: '19 October 2026', summary: 'Proposes Incorporated Trustees; separates legal membership from voluntary voting; appoints three founding trustees for initial three-year terms with no immediate re-election at activation; opens all three trustee seats together at founding-term expiry and every three years thereafter, without staggering; adds two annual representative seats, legal succession and compensation controls, and separate incorporation, representation, elected-trustee and asset-transfer milestones. All subject to Nigerian legal review.' },
    { version: '0.3.1', date: '28 October 2026', summary: 'Restates the feed commitment in Article 1: Latest and Following stay in time order, and any ranked feed, such as Discover, follows rules published on the site. Nothing else changes.' },
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
 * Seven phases in Article 13. Only draft preparation has begun. Relative term
 * deadlines are proposals; actual dates need incorporation and legal review.
 */
export const OWNERSHIP_MILESTONES: Milestone[] = [
  {
    id: 'founding-association',
    title: 'Founding Association',
    detail:
      'Drafts are published. Consultation, Nigerian legal review, formal association formation, appointment of three founding trustees and the Chairperson and Secretary, founding resolutions and operator disclosures remain outstanding.',
    status: 'in-progress',
  },
  {
    id: 'entity',
    title: 'CAC Incorporation',
    detail: 'Obtain name approval and register Incorporated Trustees under Part F of CAMA with three founding trustees. Record the incorporation date and the start and expiry of their initial three-year terms. Incorporation is not claimed today.',
    status: 'not-started',
  },
  {
    id: 'legal-membership',
    title: 'Legal Membership',
    detail: 'Establish a formal admission register and appeals; offer every eligible legal member equal access to voluntary platform voting. Prepare lawful identity and age checks. An account, verification or opt-in alone is not legal admission.',
    status: 'not-started',
  },
  {
    id: 'community-representation',
    title: 'Community Governance Activation',
    detail: 'After readiness checks, elect two community representatives for one-year terms to join the three trustees on the five-member Council. The founding trustees complete their initial terms; activation does not trigger their re-election.',
    status: 'not-started',
  },
  {
    id: 'first-trustee-election',
    title: 'First Trustee Election',
    detail: 'At the founding three-year term expiry, elect all three trustee positions together, then ordinarily every three years. Founders may contest equally. Prepare 180 days before expiry and publish the timetable by 90 days before expiry. Required association resolutions and CAC procedures remain necessary.',
    status: 'not-started',
  },
  {
    id: 'transfer',
    title: 'Legal Asset Transfer',
    detail: 'Execute and verify vesting of domains, marks, branding, IP, infrastructure accounts, funds and essential assets in the nonprofit, respecting licences and contracts. Remove unilateral founder control and disclose dependencies.',
    status: 'not-started',
  },
  {
    id: 'proof',
    title: 'Community-Controlled Organisation',
    detail: 'Publish a final transition report and independent evidence of legally effective elected trustee governance and asset control, including remaining limitations. An online election alone does not complete the transition.',
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
    turnout: 'At least 25 voters or 10% of eligible active voting members, whichever is greater',
  },
  {
    decision: 'Constitutional amendments',
    approval: 'At least two-thirds of valid votes',
    turnout: 'At least 50 voters or 20% of eligible active voting members, whichever is greater',
  },
  {
    decision: 'Sale, dissolution or permanent transfer of core assets',
    approval: 'At least 75% of valid votes, plus every required legal approval',
    turnout: 'At least 50 voters or 25% of eligible active voting members, whichever is greater',
  },
  {
    decision: 'Trustee elections (three seats every three years)',
    approval: 'Up to three choices per voter; the three most-supported eligible candidates; runoff for ties',
    turnout: 'At least 25 voters or 10% of eligible active voting members, whichever is greater',
  },
  {
    decision: 'Representative elections (two seats annually)',
    approval: 'Up to two choices per voter; the two most-supported eligible candidates; runoff for ties',
    turnout: 'At least 25 voters or 10% of eligible active voting members, whichever is greater',
  },
  {
    decision: 'Recalling a council member',
    approval: 'More than half of valid votes, after a petition by 10% of eligible active voting members',
    turnout: 'The same as an ordinary decision',
  },
] as const

/** Descriptive draft configuration only; no election or appointment scheduler. */
export const COUNCIL_PROPOSAL = {
  trustees: { seats: 3, termYears: 3, staggered: false, foundingTermStarts: 'incorporation', firstElection: 'founding-term-expiry' },
  representatives: { seats: 2, termYears: 1, firstElection: 'governance-readiness' },
  consecutiveFullTermLimit: 2,
  initialQuorum: 2,
  fullQuorum: 3,
} as const

export const TRANSITION_EXPLANATION = 'HeyNaija will initially be incorporated with three founding trustees who serve a fixed three-year term. When the community governance system becomes operational, members will elect two community representatives to join them on the Community Council. The founding trustees will complete their initial terms, after which all three trustee positions will be opened for community elections. Founders may contest these elections but receive no permanent privileges.'

/** Draft constitution v0.3, Article 8. */
export const MINIMUM_ELECTORATE = 100

/** Draft constitution v0.3, Articles 5 and 8. */
export const PROPOSAL_RULES = {
  endorsements: '10 voting members or 2% of eligible voters, whichever is greater, capped at 100; or referral by three council members',
  consultationDays: 14,
  ballotDays: 7,
  eligibilityFreezeDays: 14,
  accountAgeDays: 30,
} as const
