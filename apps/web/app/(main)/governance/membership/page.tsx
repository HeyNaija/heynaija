import type { Metadata } from 'next'
import Link from 'next/link'
import { FoundingStageNotice, GovernanceNav } from '@/app/ui/governance'
import { GovernanceIcon, ShieldIcon, VoteIcon } from '@/app/ui/icons'
import { MINIMUM_ELECTORATE, PROPOSAL_RULES } from '@/lib/governance'

export const metadata: Metadata = {
  title: 'Voting membership',
  description:
    'Who could become a HeyNaija voting member under the draft constitution, what members could do, and how one person, one vote would be protected. Registration has not opened.',
}

export default function MembershipPage() {
  return (
    <div className="governance-page">
      <header className="governance-header">
        <p className="governance-eyebrow"><GovernanceIcon size={17} /> Governance</p>
        <h1 className="mt-3 page-title">Voting membership</h1>
        <p className="governance-lead">
          Everyone with an account belongs to the HeyNaija community. Voting membership is something more: an opt-in
          role for verified adults who want a vote in how HeyNaija is run.
        </p>
        <GovernanceNav />
      </header>

      <div className="membership-status" role="note">
        <VoteIcon size={20} />
        <div>
          <p className="font-semibold">Voting membership registration has not opened.</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Nobody is a voting member yet. Everything below is proposed in the{' '}
            <Link href="/governance/constitution#article-2" className="font-semibold text-accent-strong underline">draft constitution</Link>{' '}
            and can change after consultation and legal review. If you are signed in, your own status is in{' '}
            <Link href="/settings#governance-heading" className="font-semibold text-accent-strong underline">Settings</Link>.
          </p>
        </div>
      </div>

      <section className="governance-section" aria-labelledby="eligibility-heading">
        <h2 id="eligibility-heading" className="section-title">Who could become a voting member</h2>
        <p className="governance-copy">Someone who meets all five conditions:</p>
        <ol className="eligibility-list">
          <li><strong>Is 18 or older, confirmed by a check.</strong> Saying so at signup is not enough, and an account with no age on record never counts.</li>
          <li><strong>Has completed NIN identity verification</strong> that is still valid. <Link href="/governance/verification">How verification would work</Link>.</li>
          <li><strong>Has opted in</strong> and accepted the governing documents. Verifying alone never makes anyone a member.</li>
          <li><strong>Registered before the deadline</strong> for the ballot in question.</li>
          <li><strong>Is not under a governance suspension.</strong> Any suspension must be proportionate, explained and open to appeal.</li>
        </ol>
        <p className="governance-copy">
          The final conditions must also fit the bylaws of whatever legal entity members end up controlling.
        </p>
      </section>

      <section className="governance-section" aria-labelledby="age-heading">
        <h2 id="age-heading" className="section-title">Age: accounts and voting are different</h2>
        <dl className="verification-glance">
          <div>
            <dt>Having an account</dt>
            <dd>18 or older during the beta, by your own statement. This is a temporary beta rule: younger people may be able to join later, with safeguards.</dd>
          </div>
          <div>
            <dt>Content marked for adults</dt>
            <dd>Never shown to under-18s or to accounts with no age on record, whenever such labels exist.</dd>
          </div>
          <div>
            <dt>Voting</dt>
            <dd>Always 18 or older under the draft, confirmed by a check, together with identity verification and an opt-in.</dd>
          </div>
        </dl>
      </section>

      <section className="governance-section" aria-labelledby="one-vote-heading">
        <h2 id="one-vote-heading" className="section-title">One person, one vote</h2>
        <ul className="governance-list">
          <li>Each voting member has exactly one vote in each ballot. Donations, payments, followers, job titles or tokens never add votes.</li>
          <li>One verified person can hold only one active voting membership, whichever account they use. <Link href="/governance/verification#duplicates-heading">How duplicates would be stopped</Link>.</li>
          <li>Ballots are private: who may vote is kept separate from how anyone voted.</li>
          <li>Membership is proposed to be free. If the final legal structure requires anything else, it will be put to consultation first.</li>
        </ul>
      </section>

      <section className="governance-section" aria-labelledby="timing-heading">
        <h2 id="timing-heading" className="section-title">Timing rules for binding votes</h2>
        <dl className="verification-glance">
          <div>
            <dt>Eligibility freeze</dt>
            <dd>The voter list is fixed {PROPOSAL_RULES.eligibilityFreezeDays} days before a ballot opens. Anyone who verifies later can vote in the next one.</dd>
          </div>
          <div>
            <dt>Account age</dt>
            <dd>An account must be at least {PROPOSAL_RULES.accountAgeDays} days old to vote in a binding election, unless a published transitional rule covers the first election.</dd>
          </div>
          <div>
            <dt>First binding vote</dt>
            <dd>Not before at least {MINIMUM_ELECTORATE} verified adults have opted in, the legal requirements are met and the voting controls are tested.</dd>
          </div>
        </dl>
      </section>

      <section className="governance-section" aria-labelledby="rights-heading">
        <h2 id="rights-heading" className="section-title">What voting members could do, and must not do</h2>
        <div className="vote-scope">
          <div>
            <h3 className="governance-subtitle">Rights</h3>
            <ul className="governance-list">
              <li>Vote in council elections, recalls and reserved member decisions</li>
              <li>Propose changes, and endorse other members’ proposals</li>
              <li>Nominate candidates and stand for the Community Council</li>
              <li>Read non-confidential governance records and ask for explanations of major council decisions</li>
              <li>Challenge procedural mistakes and complain without retaliation</li>
              <li>Leave at any time</li>
            </ul>
          </div>
          <div>
            <h3 className="governance-subtitle">Obligations</h3>
            <ul className="governance-list">
              <li>Never sell a vote or pressure someone else’s</li>
              <li>Never impersonate anyone</li>
              <li>Never hold more than one voting membership</li>
              <li>Never misuse anyone’s private verification data</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="governance-section" aria-labelledby="appeals-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><ShieldIcon size={22} /></span>
          <h2 id="appeals-heading" className="section-title">Suspensions and appeals</h2>
        </div>
        <ul className="governance-list">
          <li>Governance privileges could only be suspended with documented reasons, a proportionate restriction, an appeal and independent review.</li>
          <li>Disagreeing with, or criticising, whoever runs HeyNaija is never a reason to lose a vote.</li>
          <li>Disputed sanctions involving council elections would go to a separate adjudicator or a panel of people not involved.</li>
          <li>Ordinary moderation of posts and accounts follows the <Link href="/rules">rules</Link> and its own appeals, and is never decided by a vote.</li>
        </ul>
      </section>

      <FoundingStageNotice />
    </div>
  )
}
