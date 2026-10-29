import type { Metadata } from 'next'
import Link from 'next/link'
import { Placeholder, PolicyPage } from '@/app/ui/policy-page'
import { CONSTITUTION, OWNERSHIP_MILESTONES, TRANSITION_EXPLANATION } from '@/lib/governance'

export const metadata: Metadata = { title: 'Charter' }

export default function CharterPage() {
  return (
    <PolicyPage
      eyebrow="Our shared future"
      title="HeyNaija Community Governance Charter"
      summary="What HeyNaija is for, the promises it makes to members now, who is responsible for it today, and the steps toward members having a real say in how it is run. It is honest about what has not happened yet."
      version={CONSTITUTION.label}
      updated={CONSTITUTION.updated}
      sections={[
        {
          id: 'purpose',
          title: 'Purpose',
          body: (
            <p>
              HeyNaija is a place for useful, locally grounded conversation between Nigerians at home and
              abroad: fast on any phone, fairly moderated, and built so that the people who use it can
              eventually help decide how it is run.
            </p>
          ),
        },
        {
          id: 'constitution',
          title: 'This charter and the draft constitution',
          body: (
            <>
              <p>
                This charter keeps today’s service promises and describes the proposed community governance framework.
                Future offices and rights below remain proposals until lawfully adopted. The separate{' '}
                <Link href="/governance/constitution">CAC-facing nonprofit constitution</Link> would be the association’s
                legal constitution once adopted and registered. Applicable law and that registered constitution prevail;
                the charter and supporting policies cannot amend them. Any inconsistency must be disclosed and corrected.
              </p>
              <p>
                Incorporated Trustees under Part F of CAMA 2020 is the proposed registration structure. HeyNaija is
                founder-operated today; incorporation, representative elections, elected trustee governance and asset
                control are separate milestones. No binding election or NIN verification is live. Current account and
                privacy rules remain in the <Link href="/rules">rules</Link> and <Link href="/privacy">privacy policy</Link>.
                Qualified Nigerian nonprofit counsel must review the whole framework before legal adoption or filing.
              </p>
            </>
          ),
        },
        {
          id: 'promises',
          title: 'Promises we keep today',
          body: (
            <ul>
              <li><strong>Feeds you can check.</strong> Latest and Following are in time order. <Link href="/about/discover">Discover</Link> ranks recent posts by rules published on the site, using only what anyone can see here, and says why each post is there. Nothing is ranked by what keeps you scrolling, and nothing is paid for.</li>
              <li><strong>No ads, no selling data.</strong> See the <Link href="/privacy">privacy policy</Link>.</li>
              <li><strong>Your data is yours to take.</strong> Download everything about you from Settings, any time.</li>
              <li><strong>Open source.</strong> The code is licensed under the AGPL; see the <Link href="/licence">licence</Link>.</li>
              <li><strong>Accountable moderation.</strong> Published <Link href="/rules">rules</Link>, a permanent record of every moderation decision, notice when a decision affects you, and appeals.</li>
              <li><strong>Built for low-cost phones and slow connections.</strong></li>
            </ul>
          ),
        },
        {
          id: 'stewards',
          title: 'Who is responsible today',
          body: (
            <>
              <p>
                HeyNaija is founder-operated, with no incorporation or legal community ownership claimed. Today it is run, paid for and decided by its
                provisional custodians: <Placeholder>names and roles</Placeholder>. They are accountable
                for keeping the promises above.
              </p>
              <p>
                It is funded by <Placeholder>how HeyNaija is funded today</Placeholder>. No money is being
                collected from members.
              </p>
              <p>
                The draft constitution asks for the custodians’ names and roles, and the legal operator, to be published
                before a broad public launch (Article 13). They are not published yet.
              </p>
            </>
          ),
        },
        {
          id: 'path',
          title: 'The path to community ownership',
          body: (
            <>
              <p>
                These are the seven phases the draft constitution proposes (Article 13). Where each one stands is
                shown on the <Link href="/governance#ownership">governance page</Link>, and each will be announced there
                when it is done. Legal asset control has not transferred. Platform ballots need the legal, membership,
                security and readiness gates; an election by itself never completes the asset transfer.
              </p>
              <p>Proposed arrangement: {TRANSITION_EXPLANATION}</p>
              <ol>
                {OWNERSHIP_MILESTONES.map((phase) => <li key={phase.id}><strong>{phase.title}.</strong> {phase.detail}</li>)}
              </ol>
              <p>Prepare the first trustee election 180 days before term expiry and publish its timetable by 90 days
                before expiry. If online governance is delayed, use lawful formal member procedures reviewed by
                counsel. Any caretaker authority needs an express legal basis and prior member resolution, lasts at
                most 90 days and cannot be renewed under the fallback clause. There is no indefinite founder holdover.</p>
              <p>A public treasury opens once money flows, with reports at least every quarter.</p>
            </>
          ),
        },
        {
          id: 'participation', title: 'Proposed democratic participation and accountability',
          body: <>
            <p>Platform users have accounts; legal members are formally admitted to the association; active voting
              members are eligible legal members who voluntarily activate platform ballots. Every eligible legal member
              has equal access to activation and one equal-weight ballot. Online opt-out does not terminate legal
              membership or lawful formal meeting rights. No donation, founder status or subscription buys more power.</p>
            <p>Voting remains 18+ with verified age and identity. NIN is initially preferred; legally acceptable future
              alternatives need equivalent safeguards. Identity, legal admission, online activation and optional badges
              remain separate. No NIN or sensitive identity data may be exposed publicly.</p>
            <p>The full Council is three registered trustees on a common three-year cycle and two community
              representatives elected annually. Representatives oversee community interests and accountability without
              automatically becoming trustees. Quorum is two for the initial trustee body and three for the full Council;
              routine decisions use a majority of non-conflicted members present, with ties failing. The retained limit
              is two consecutive full terms per role followed by a one-term break; the founding term counts.</p>
            <p>Preserve published nominations, equal candidate access, secret auditable ballots, independent oversight,
              published results, impartial dispute resolution and fair recall. A 10% petition can initiate recall without
              founder permission; formal legal-member meeting rights provide a separate route. Notice, a fair hearing,
              lawful trustee resolutions and applicable CAC procedures remain required. Individual moderation cases
              stay outside public votes, with independent appeals and privacy safeguards.</p>
            <p>Keep the existing proposed electorate, turnout, consultation and notice safeguards in{' '}
              <Link href="/governance/constitution#article-8">Article 8</Link>. Supporting election and membership policies
              depend on recognition in the registered constitution wherever necessary to give them legal effect.</p>
          </>,
        },
        {
          id: 'independence', title: 'Proposed nonprofit finance and protection from capture',
          body: <>
            <p>The nonprofit shall have no private shareholders or profit distributions. Income and property serve its
              objects; donors, political parties and private commercial interests acquire no exclusive control. Lawful
              grants, donations, voluntary contributions, permitted subscriptions, revenue and sponsorships need
              transparent conditions, budgets, accounts and independent audits.</p>
            <p>Propose at least three bank signatories with any two independent approvals, subject to trustee approval,
              the constitution and bank requirements. No individual may withdraw organisational funds or control
              essential assets alone. Founder compensation for real work requires legal clearance, disinterested
              approval and conflict disclosure. CAMA section 838 restricts paid offices and benefits for Council members,
              including trustees and representatives; recusal does not itself make an unlawful payment lawful.</p>
            <p>Domains, branding, IP, infrastructure and funds must be vested through lawful instruments and access
              changes, respecting licences and contracts. On dissolution, debts are settled and residual assets pass
              only to legally eligible compatible institutions or the lawful charitable destination, never founders or
              members. The legal constitution and Nigerian legal review govern these actions.</p>
          </>,
        },
        {
          id: 'changes',
          title: 'Changing this charter',
          body: (
            <p>
              Until members can lawfully govern HeyNaija, the custodians may change this charter, but only by
              announcing the change on the governance page at least <Placeholder>notice period</Placeholder>{' '}
              before it takes effect, saying what changed and why. The draft constitution proposes 14 days
              (Article 14), except for urgent legal or security corrections; that is not yet adopted.
            </p>
          ),
        },
        {
          id: 'version-history', title: 'Draft version history',
          body: <ul>{CONSTITUTION.changelog.map((entry) => <li key={entry.version}>
            <strong>v{entry.version}, {entry.date}:</strong> {entry.summary}
          </li>)}</ul>,
        },
      ]}
    />
  )
}
