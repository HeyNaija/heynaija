import type { Metadata } from 'next'
import Link from 'next/link'
import { FeedbackNotice, GovernanceNav } from '@/app/ui/governance'
import { PolicyPage } from '@/app/ui/policy-page'
import { CONSTITUTION } from '@/lib/governance'

export const metadata: Metadata = {
  title: 'Draft constitution',
  description: `HeyNaija Governance Constitution, ${CONSTITUTION.label}. Proposed for public consultation; not yet adopted or legally operative.`,
}

// The text follows HEYNAIJA_GOVERNANCE_CONSTITUTION_DRAFT.md (draft v0.2) article
// for article. Change it only by publishing a new version: bump CONSTITUTION in
// lib/governance.ts and add a version-history entry saying what changed.

export default function ConstitutionPage() {
  return (
    <PolicyPage
      eyebrow="Governance"
      title="HeyNaija Governance Constitution"
      summary="How HeyNaija proposes to become a member-controlled, open-source Nigerian social platform: who can become a voting member, how votes and elections work, what the council does, and what has to happen before any of it is legally real."
      version={CONSTITUTION.label}
      updated={CONSTITUTION.updated}
      numbered={false}
      header={<GovernanceNav />}
      notice={
        <div className="notice policy-draft constitution-status" role="note">
          <p>
            <strong>DRAFT.</strong> {CONSTITUTION.status}
          </p>
          <p className="mt-2">
            Jurisdiction: Nigeria, subject to review by qualified Nigerian cooperative, corporate and data-protection
            counsel. This is a governance-design draft, not Nigerian legal advice, and nothing in it applies until it is
            validly adopted with a published effective date.
          </p>
        </div>
      }
      sections={[
        {
          id: 'promise',
          title: 'Plain-language promise',
          body: (
            <>
              <blockquote className="constitution-promise">
                HeyNaija is being built to become a member-controlled, open-source Nigerian social platform. Anyone
                eligible may use ordinary social features without a NIN check. Adults who opt in, complete authorised
                NIN identity verification and meet the conditions in this constitution may become voting members. Each
                voting member receives one vote. Founders currently operate HeyNaija; the transfer to legally
                enforceable community ownership has <strong>not yet happened</strong>.
              </blockquote>
              <p>
                This proposal supplements the existing <Link href="/charter">HeyNaija charter</Link>,{' '}
                <Link href="/governance">governance page</Link>, <Link href="/rules">Community Rules</Link> and{' '}
                <Link href="/privacy">Privacy Policy</Link>. It does <strong>not</strong> override applicable law, a
                future registered entity’s binding constitution or current legal obligations. Conflicts are to be
                resolved transparently with counsel and published amendments.
              </p>
            </>
          ),
        },
        {
          id: 'article-1',
          title: 'Article 1 — Purpose and values',
          body: (
            <ol>
              <li>HeyNaija exists to host useful, inclusive, locally grounded conversations for Nigerians at home and abroad, and others legitimately participating in those communities.</li>
              <li>HeyNaija aims to become community-controlled, with accountable leadership, fair moderation, accessible participation, financial transparency, open-source software and meaningful user-data rights.</li>
              <li>The platform will not assign extra governance votes in return for donations, sponsorship, follower counts, job titles or ownership of tokens.</li>
              <li>The service must maintain the current public commitments in the founding charter unless amended through the applicable process: chronological feeds, no advertising or data sales during the current pilot, published moderation rules, data export and open-source development. Any proposed change must be explicitly disclosed and properly approved.</li>
            </ol>
          ),
        },
        {
          id: 'article-2',
          title: 'Article 2 — Meaning of membership',
          body: (
            <dl>
              <dt>Registered user</dt>
              <dd>Anyone permitted to maintain an account under the Terms, Community Rules, age policy and applicable law. Registration does not confer a governance vote.</dd>
              <dt>Identity-verified user</dt>
              <dd>A user whose identity has been confirmed via an authorised NIMC/NINAuth verification workflow, with valid consent and a sufficiently strong match to the account holder. The verification may be withdrawn, expire or be revoked. Identity verification does not confirm citizenship, trustworthiness, the accuracy of posts or support from HeyNaija.</dd>
              <dt>Voting member</dt>
              <dd>An eligible individual who (a) is at least 18, (b) has completed valid NIN identity verification, (c) has opted into membership and accepted the governing documents, (d) meets the election registration deadline, and (e) is not under a proportionate, appealable suspension of governance privileges. The final membership mechanism must align with the chosen legal entity’s bylaws and requirements.</dd>
              <dt>Community Council</dt>
              <dd>Five voting members elected to exercise delegated governance and oversight powers on fixed terms.</dd>
              <dt>Operator</dt>
              <dd>The person or entity legally operating the service at the relevant date, named in a published operator disclosure. During the founding period this is not yet a community-owned organisation.</dd>
            </dl>
          ),
        },
        {
          id: 'article-3',
          title: 'Article 3 — Ordinary accounts, ages and youth safety',
          body: (
            <ol>
              <li><strong>Proposed pilot rule:</strong> HeyNaija’s invite-only initial beta is for adults aged <strong>18 or older</strong>. Add this restriction to the Terms, signup flow and Privacy Policy only once the product team adopts it; do not silently imply that it already exists.</li>
              <li>At initial signup, request the minimum age assurance necessary for the 18+ rule (for example an age affirmation, backed by appropriate risk-based checks). Do not require an NIN for an ordinary account.</li>
              <li>An eventual age-appropriate experience for 13–17-year-olds requires <strong>separate approval</strong> of parental/guardian consent controls where necessary, safeguarding, age-assurance design, privacy assessment, reporting and content filtering. It must be disabled until legally and operationally ready. Accounts below the adopted minimum age must not be permitted.</li>
              <li>Store an internal age band or over-18 eligibility flag where feasible, rather than revealing exact age or birth date on profiles. If a date of birth is genuinely necessary, document its purpose, lawful basis, safeguards and retention period before collecting it.</li>
              <li>Moderation must restrict harmful or age-inappropriate material using content classification, rules, reporting, defaults and access controls, not just self-reported ages. Unlawful material remains prohibited for all ages.</li>
              <li>Publish clear procedures for mistaken-age decisions and challenges, without asking minors to disclose identity documents publicly.</li>
            </ol>
          ),
        },
        {
          id: 'article-4',
          title: 'Article 4 — Identity verification, green tick and privacy',
          body: (
            <ol>
              <li><strong>NIN verification is optional for ordinary social activity and required for initial voting-membership eligibility.</strong> It must be opt-in with an understandable explanation of exactly what is shared and why.</li>
              <li>Verification must use a <strong>properly authorised provider/approved NINAuth integration</strong>. Until commercial access, legally required assessments, provider scopes and contractual guarantees are approved, production verification remains disabled. A beta page may show “Verification coming soon,” never a false success.</li>
              <li>Prefer NINAuth’s consent-based QR, share-code or authorised sign-in flow. The front end must <strong>not solicit raw NIN numbers, NIN slips or photographs of identity documents</strong> unless a separately approved legal and technical design proves such collection essential.</li>
              <li>Save only necessary results: provider, verification status, verified-at and expiry dates, age-over-18 assurance when permitted, and a <strong>provider-approved, stable pseudonymous person key</strong> if available. Store any sensitive identity-related metadata in a restricted database/schema with encrypted storage and strict access controls.</li>
              <li>The person key must support one-person-one-active-voting-membership across account changes. <strong>Do not assume a provider supplies a stable cross-session identifier; confirm contractual and technical support first.</strong> Do not use raw NIN or unsalted/plain hashes of NIN as the public or internal membership ID. A keyed derivation is still personal data and needs legal review.</li>
              <li>The optional <strong>green tick</strong> should have accessible text such as “NIN identity verified,” an explanatory tooltip and a revocation path. It is not an endorsement, citizenship badge or accuracy badge. Users may hide the public tick without losing private eligibility, subject to final rules.</li>
              <li>Public profiles, post APIs, logs and analytics must never reveal NIN, date of birth, provider responses, verification tokens or private voting membership identifiers.</li>
              <li>Provide correction, revocation, account-merger and appeals processes. Publish a reviewed retention schedule and incident-response process. Verify whether legally required records must be kept before deleting or anonymising them.</li>
              <li>NIMC issues NINs to citizens <strong>and legal residents</strong>; NIN verification alone is not proof of Nigerian citizenship. The initial electorate is defined by approved NIN-backed adult membership, <strong>not</strong> an unverified claim of citizenship. Review the diaspora accessibility impact with members and counsel. A future alternative identity method requires a formal constitutional amendment and equivalent anti-duplicate-voting assurance.</li>
            </ol>
          ),
        },
        {
          id: 'article-5',
          title: 'Article 5 — Member rights and obligations',
          body: (
            <ol>
              <li>Every eligible member has one vote in each applicable ballot, the right to propose changes, nominate and stand for council (subject to published impartial criteria), and inspect non-confidential governance records.</li>
              <li>Members may request explanations of material council decisions, challenge procedural errors, access their data and complain without retaliation.</li>
              <li>Members must not sell votes, impersonate another person, coerce voters, create duplicate voting memberships, or misuse private verification data.</li>
              <li>Membership is voluntary and <strong>free of mandatory membership fees during the initial model</strong>, subject to subsequent legal review of the final cooperative/entity structure. Payments and donations never create additional votes.</li>
              <li>Voting eligibility freezes 14 days before a ballot opens; persons who newly verify after that cutoff remain eligible for later ballots. An account must have existed for 30 days before voting in a binding election, unless the initial constituent election uses a separately published transitional rule.</li>
              <li>Governance sanctions require documented reasons, proportionate restrictions, an appeal and independent review. Ordinary disagreement or criticism of the operator must not remove voting rights.</li>
            </ol>
          ),
        },
        {
          id: 'article-6',
          title: 'Article 6 — Division of authority',
          body: (
            <dl>
              <dt>Members decide</dt>
              <dd>Council elections and recalls; adoption and amendment of this constitution; mission changes; proposed sale or permanent transfer of core assets; dissolution or change in member-control structure; and other reserved matters required by law or bylaws.</dd>
              <dt>Council oversees</dt>
              <dd>Budgets and public financial reporting; appointment and oversight of operating leads; roadmap priorities; policy process; conflicts of interest; safeguarding and risk; independent audit; and progress toward legal member ownership.</dd>
              <dt>Operations team decides</dt>
              <dd>Releases, architecture, security patches, service reliability, routine hiring and vendor management within approved budgets and policy.</dd>
              <dt>Moderation team decides</dt>
              <dd>Individual content reports and sanctions under published rules. Appeals are heard by independent reviewers where possible. <strong>No public vote may determine an individual’s ban, post removal, private account record or identity status.</strong></dd>
              <dt>Emergency authority</dt>
              <dd>Designated operators may act immediately to stop a material threat to safety, privacy or service operation; document the action promptly and present it for independent or council review within seven days where safe and lawful.</dd>
            </dl>
          ),
        },
        {
          id: 'article-7',
          title: 'Article 7 — Community Council',
          body: (
            <ol>
              <li>Five seats, <strong>12-month terms</strong>, elected by eligible voting members. No more than two consecutive full terms without a one-term break.</li>
              <li>Candidates must be eligible adult voting members, accept conflict-of-interest disclosures, and meet election-integrity requirements. No individual gets an automatic permanent founder seat.</li>
              <li>Council meetings require at least three members to reach a quorum; routine decisions pass by majority of council members present, unless reserved for members or subject to a stricter rule.</li>
              <li>Council minutes, votes and conflicts are published with lawful redactions for safety, personnel and private information.</li>
              <li>Paid executives or contractors with material operational conflicts must recuse themselves on affected decisions. The final legal documents should address when such persons may hold council seats at all.</li>
              <li>Vacancies are filled through a by-election or a previously disclosed runner-up rule, subject to law. Material misconduct can trigger an independently administered recall ballot.</li>
            </ol>
          ),
        },
        {
          id: 'article-8',
          title: 'Article 8 — Proposals, voting and elections',
          body: (
            <ol>
              <li>A voting member may submit a proposal with purpose, exact proposed text, alternatives, costs, risk assessment and affected policies.</li>
              <li>To advance to a formal ballot, the proposal needs <strong>10 endorsing voting members or 2% of eligible voters, whichever is greater, capped at 100 endorsements</strong>, or referral by at least three council members. Organisers provide a transparent administrative screening process and an appeal for rejections.</li>
              <li>Publish an ordinary consultation for at least <strong>14 days</strong>, followed by ballot notice and a <strong>7-day</strong> secure voting period. Emergency safety measures are exempt from advance consultation, but not retrospective review.</li>
              <li><strong>Ordinary member decisions:</strong> more than 50% of valid votes cast, with at least the greater of <strong>25 voters or 10% of eligible voting members</strong> participating.</li>
              <li><strong>Constitutional amendments:</strong> at least two-thirds of valid votes cast, with at least the greater of <strong>50 voters or 20% of eligible voting members</strong> participating, subject to any stricter statutory requirement.</li>
              <li><strong>Sale, dissolution or irreversible transfer of core assets:</strong> at least 75% approval of valid votes cast, with at least the greater of <strong>50 voters or 25% of eligible members</strong> participating, and all required legal approvals. Members must receive a plainly written asset-impact statement.</li>
              <li><strong>Council elections:</strong> secure equal-weight ballots and a published candidate/election method; initially the five highest-supported eligible candidates fill the seats, with a runoff to settle ties. Election turnout quorum is the greater of 25 voters or 10% of eligible voting members. For fairness, publish whether voters can select up to five candidates and use the same rule for every voter.</li>
              <li>If turnout quorum is not met, <strong>no binding decision passes</strong>. Reopen discussion and rerun the ballot; do not quietly lower the threshold.</li>
              <li>Voting must use a private, independently auditable one-person-one-ballot mechanism. Separate eligibility from ballot choices: administrators must not have a convenient table mapping named users to how they voted. Publish aggregate counts and independent audit outcomes, not voter identities or raw ballots.</li>
              <li>No binding vote should launch until there are at least <strong>100 NIN-verified, opted-in adult voting members</strong>, legal/bylaw requirements are satisfied, and independent voting controls have been tested. Early feedback polls may operate but must be labelled <strong>non-binding</strong>.</li>
              <li>The first constituent election may adopt a one-time transitional calendar and quorum only through a publicly reviewed, legally compatible founding procedure; never apply ad hoc exceptions after voting begins.</li>
            </ol>
          ),
        },
        {
          id: 'article-9',
          title: 'Article 9 — Council accountability and removal',
          body: (
            <ol>
              <li>Any <strong>10% of eligible voting members</strong> may petition for an independently managed recall of a council representative, subject to safeguards against repeated abusive petitions.</li>
              <li>A recall requires a properly notified ballot, a majority of valid votes, and at least the ordinary-member-vote turnout quorum, unless law imposes a different standard.</li>
              <li>Officials facing allegations must have notice and a fair opportunity to respond. Emergency interim suspension for severe security, harassment or fraud concerns requires independent review.</li>
              <li>Elected officers may not modify electoral records, identity-verification outcomes or audit logs without authorised, traceable processes.</li>
            </ol>
          ),
        },
        {
          id: 'article-10',
          title: 'Article 10 — Funding and public treasury',
          body: (
            <ol>
              <li>Publish revenue sources, operating costs, council-approved allocations and periodic independently reviewed financial summaries. Never display simulated balances or pretend receipts exist.</li>
              <li>Payments to founders, councillors, their relatives or companies they control must be disclosed with appropriate privacy protection, conflicts managed and approvals documented.</li>
              <li>Donations, grants and subscriptions may fund operations but <strong>must not confer votes or control</strong>. Any material sponsorship terms must be disclosed.</li>
              <li>The council proposes an annual budget. Members may scrutinise it; legally reserved member approvals remain mandatory. Publish financial reports at least quarterly once funds begin to flow.</li>
              <li>No individual has a unilateral right to withdraw community-controlled assets or sell the platform after the transfer to the member-controlled entity.</li>
            </ol>
          ),
        },
        {
          id: 'article-11',
          title: 'Article 11 — Moderation, safety and appeals',
          body: (
            <ol>
              <li>Community Rules and applicable law govern posting and safety; governance voting does not override legal obligations or individual rights.</li>
              <li>Moderation must provide notice and reasons where reasonably possible, avenues to appeal, safeguards for minors when they are permitted, and independent periodic reviews.</li>
              <li>Moderation cases, identity documents, voting secrets and personal data are never published in the treasury or decision log. Transparency reports should use aggregated/anonymised statistics.</li>
              <li>Suspensions affecting governance membership may be appealed. A separate adjudicator or recused panel must review disputed sanctions involving council elections.</li>
            </ol>
          ),
        },
        {
          id: 'article-12',
          title: 'Article 12 — Technology and openness',
          body: (
            <ol>
              <li>HeyNaija’s source code is intended to remain publicly available under the licence already stated in the current charter, subject to legal review of the precise repositories, ownership and third-party dependencies.</li>
              <li>Publish release history and security disclosure guidance. Protect secrets, verification credentials and personally identifying data; open source does not require public access to production infrastructure or user information.</li>
              <li>Support user data export and account deletion subject to legal retention obligations. Document how portability will improve over time.</li>
              <li>Material changes to default feed principles, collection of identity data or the possibility of advertising must follow the applicable policy and reserved-member process.</li>
            </ol>
          ),
        },
        {
          id: 'article-13',
          title: 'Article 13 — Ownership and legal transition',
          body: (
            <ol>
              <li>HeyNaija <strong>is not presently community-owned</strong>. The named founding custodians are responsible until lawful authority is transferred; publish their names/roles and the legal operator’s identity before broad public launch.</li>
              <li>
                Proposed sequence: (a) publish drafts and operator disclosures; (b) run public consultations and a temporary
                advisory group; (c) undertake legal/privacy due diligence; (d) choose and register a suitable
                member-controlled Nigerian legal entity; (e) adopt its lawful membership bylaws and hold first proper
                elections; (f) transfer designated domain, marks, operational assets, code rights or licences, and
                governance control by executed documents; (g) publish independent confirmation.
              </li>
              <li>Do not label community feedback polls “binding” or claim ownership has transferred until these milestones are demonstrably complete.</li>
              <li>No promise here can substitute for a legal transfer of ownership. Counsel must align this document with cooperative legislation or another legally appropriate organisational form, including any applicable member qualification, financial and dissolution rules.</li>
              <li>Publish a target transition timetable after the legal feasibility review rather than inventing a binding deadline before that work is complete.</li>
            </ol>
          ),
        },
        {
          id: 'article-14',
          title: 'Article 14 — Constitutional review and effective date',
          body: (
            <ol>
              <li>While in draft, mark all pages <strong>Draft — open for comment — not legally adopted</strong> with a version date and changelog. Publish consultation feedback and how it was addressed.</li>
              <li>During the founding stage, the operator may revise proposals with at least <strong>14 days’ public notice</strong> except urgent legal or security corrections, which must be justified and disclosed promptly. This is a proposed replacement for the current charter’s unspecified notice placeholder, subject to adoption.</li>
              <li>Following lawful adoption, constitutional amendments use the stricter ballot and entity-specific legal requirements in Article 8.</li>
              <li>This constitution becomes operative only after the valid adoption action, applicable legal checks and an explicitly published effective date.</li>
            </ol>
          ),
        },
        {
          id: 'annex-a',
          title: 'Annex A — Identity and age implementation safeguards',
          body: (
            <ul>
              <li>Start with <strong>NINAuth partner research, pricing, authorised scopes, callback contract, person-uniqueness support, verified-age claims, and data-sharing terms</strong>. Do not treat example API payloads as proof of production access.</li>
              <li>Complete a documented data protection impact assessment (DPIA) or equivalent risk review, reviewed by Nigerian privacy counsel. NIN processing may pose a high risk and may trigger duties under applicable law.</li>
              <li>Separate identity-verification records from governance memberships, ballot eligibility and public profile badges. These are different states.</li>
              <li>Use signed, validated provider callbacks (issuer/audience/signature/expiry/state/PKCE as applicable); reject duplicated/replayed events and avoid leaking tokens to logs.</li>
              <li>Capture a user’s <strong>explicit opt-in</strong> to join voting membership; NIN verification alone must not make them a legal member automatically.</li>
              <li>Keep the green badge optional in public; allow revocation/expiry. If the verification provider cannot support anti-sybil guarantees, block formal voting rather than pretending uniqueness is assured.</li>
              <li>No raw NIN in user tables, browser analytics, support tickets, logs, exports, crash reporting or audit summaries. Protect provider tokens and minimise verification traces.</li>
              <li>At beta, 18+ only. Youth rollout requires its own decision, privacy-policy change, legally appropriate guardian controls and safety testing.</li>
              <li>Membership and ballots must have server-side policy enforcement and audit trails; frontend hiding of buttons is insufficient.</li>
            </ul>
          ),
        },
        {
          id: 'annex-b',
          title: 'Annex B — Decisions remaining open for consultation',
          body: (
            <ol>
              <li>Final legal vehicle (cooperative versus another member-controlled structure) and what member admission/fees it legally requires.</li>
              <li>Diaspora fairness where a person cannot obtain or complete the authorised NINAuth flow; identity assurance alternatives may need a future charter amendment.</li>
              <li>Identity-verification provider, business onboarding, pricing, stable uniqueness identifier and exactly which age claims can be received.</li>
              <li>Whether a public green tick defaults on or is optional (this draft recommends optional).</li>
              <li>Youth policy after the initial 18+ beta.</li>
              <li>Council conflict rules, member petition thresholds and election method after public consultation/legal review.</li>
              <li>Realistic election readiness/turnout thresholds after the first 100 verified adults, with no retroactive rule changes.</li>
              <li>Correct operator name, custodians, privacy contact, data-centre location, cross-border transfer safeguards and retention schedule currently missing from public pages.</li>
            </ol>
          ),
        },
        {
          id: 'references',
          title: 'Primary references',
          body: (
            <>
              <ul>
                <li><a href="https://nimc.gov.ng/nin/" rel="noreferrer">NIMC — National Identification Number</a>: NIN eligibility, uniqueness and warnings against disclosing the number publicly.</li>
                <li><a href="https://ninauth.nimc.gov.ng/get-started" rel="noreferrer">NIMC — NINAuth Getting Started</a>: consent-based QR and share-code verification.</li>
                <li><a href="https://ninauth.nimc.gov.ng/verification-partner" rel="noreferrer">NIMC — NINAuth Verification Partners</a>: enterprise/partner approval and compliance prerequisites.</li>
                <li><a href="https://sso.ninauth.nimc.gov.ng/demo-sign-in/developer-guide" rel="noreferrer">NIMC — NINAuth developer guide</a>: example OAuth implementation; not a grant of commercial access.</li>
                <li><a href="https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf" rel="noreferrer">Nigeria Data Protection Act 2023</a>: data protection, children, privacy rights and risk assessments.</li>
                <li><a href="https://nitda.gov.ng/wp-content/uploads/2022/10/APPROVED-NITDA-CODE-OF-PRACTIVE-FOR-INTERACTIVE-COMPUTER-SERVICE-PLATFORMS-INTERNET-INTERMEDIARIES-2022-002.pdf" rel="noreferrer">NITDA Code of Practice</a>: platform safety and child-access controls.</li>
              </ul>
              <p>
                <strong>
                  This is a governance-design draft, not Nigerian legal advice. A Nigerian lawyer specialising in
                  corporate/cooperative and data-protection law must review it before adoption or live identity collection.
                </strong>
              </p>
            </>
          ),
        },
        {
          id: 'version-history',
          title: 'Version history and feedback',
          body: (
            <>
              <ul className="constitution-versions">
                {CONSTITUTION.changelog.map((entry) => (
                  <li key={entry.version}>
                    <strong>v{entry.version}</strong>, {entry.date}: {entry.summary}
                  </li>
                ))}
              </ul>
              <p>
                Every revision of this draft is listed here with what changed. Article 14 proposes that, during the
                founding stage, revisions are announced at least 14 days before they take effect, except urgent legal or
                security corrections; that notice period is itself part of the proposal.
              </p>
              <FeedbackNotice />
            </>
          ),
        },
      ]}
    />
  )
}
