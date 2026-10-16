import type { Metadata } from 'next'
import Link from 'next/link'
import { FoundingStageNotice, GovernanceNav } from '@/app/ui/governance'
import { ChevronIcon, GovernanceIcon, IdentityIcon, ShieldIcon, VerifiedIcon } from '@/app/ui/icons'
import { BADGE_TOOLTIP, IdentityBadge } from '@/app/ui/identity-badge'
import { MINIMUM_ELECTORATE, PROPOSAL_RULES } from '@/lib/governance'

export const metadata: Metadata = {
  title: 'Identity verification',
  description:
    'How optional NIN identity verification would work on HeyNaija, what the green tick means, and why it is not live yet. HeyNaija is not collecting NIN details.',
}

const faq = [
  {
    q: 'Why verify?',
    a: (
      <>
        <p>
          Two reasons, both optional. Voting membership, when it opens, needs a strong check that every member is a
          real, distinct adult, so that one person really does get one vote. And some people may want a green tick so
          others know a verified person holds the account.
        </p>
      </>
    ),
  },
  {
    q: 'Can I post without verifying?',
    a: (
      <p>
        Yes. Posting, replying, following, joining communities, reporting and appealing never need a NIN, now or under
        the draft constitution.
      </p>
    ),
  },
  {
    q: 'Do I need to prove my age to join?',
    a: (
      <p>
        No. During the beta you confirm yourself that you are 18 or older, and that is all. It is a statement, not a
        verified age, and the 18+ rule is temporary, for the beta. Your age is never shown on your profile.
      </p>
    ),
  },
  {
    q: 'Is age verification the same as NIN verification?',
    a: (
      <p>
        No, they are separate. An identity check may also say whether you are 18 or older, but HeyNaija keeps your age
        on its own, as a band, and could check age in other ways without checking identity. Neither check is active
        today. Voting membership would need both: a verified identity and a verified adult age.
      </p>
    ),
  },
  {
    q: 'Does NIN prove citizenship?',
    a: (
      <p>
        No. NIMC issues NINs to Nigerian citizens and to legal residents, so a verified identity says nothing about
        nationality. The tick is not a citizenship badge, and the proposed first electorate is verified adults who opt
        in, not people claiming citizenship.
      </p>
    ),
  },
  {
    q: 'Can I hide my tick?',
    a: (
      <p>
        Yes. The draft recommends that the public tick is optional: you choose whether to show it, and hiding it does
        not affect whether you can be a voting member, subject to the final rules. Whether it should start on or off is
        one of the questions still open for consultation.
      </p>
    ),
  },
  {
    q: 'What about diaspora Nigerians?',
    a: (
      <p>
        You can use HeyNaija from anywhere without a NIN. Voting membership is harder: the first design depends on
        NINAuth, and some people abroad may not have a NIN or be able to complete it. This is an open question in the
        draft (Annex B). Any other way of proving identity would need a formal amendment to the constitution and the same
        protection against duplicate votes.
      </p>
    ),
  },
  {
    q: 'Do I have to expose my real name?',
    a: (
      <p>
        No. Your handle and display name stay your choice. HeyNaija would not keep or show your legal name, NIN, date of
        birth or anything else the provider holds. If you show the tick, it says only that an identity was verified,
        not whose.
      </p>
    ),
  },
  {
    q: 'What happens if verification fails?',
    a: (
      <p>
        Nothing changes for your account: you keep posting as before, and the failure is never shown publicly. You would
        be told it did not complete, could try again, and could ask for a review if you think it is a mistake, for
        example a wrong match with another account.
      </p>
    ),
  },
  {
    q: 'How is voting protected?',
    a: (
      <ul>
        <li>One verified person can hold only one voting membership, using a private key from the provider rather than your NIN.</li>
        <li>The list of eligible voters is fixed {PROPOSAL_RULES.eligibilityFreezeDays} days before a ballot opens, and an account must be at least {PROPOSAL_RULES.accountAgeDays} days old to vote in a binding election.</li>
        <li>Who may vote is kept apart from how anyone voted, so nobody, administrators included, can look up your choice.</li>
        <li>Totals and independent audit results are published; voter identities and raw ballots are not.</li>
        <li>No binding vote opens until at least {MINIMUM_ELECTORATE} verified adults have opted in and the voting controls have been independently tested.</li>
      </ul>
    ),
  },
]

export default function VerificationPage() {
  return (
    <div className="governance-page">
      <header className="governance-header">
        <p className="governance-eyebrow"><GovernanceIcon size={17} /> Governance</p>
        <h1 className="mt-3 page-title">Identity verification</h1>
        <p className="governance-lead">
          How optional NIN verification would work, what the green tick would and would not mean, and why you never need
          it to use HeyNaija.
        </p>
        <GovernanceNav />
      </header>

      <p className="notice governance-status" role="note">
        <strong>Coming soon; not collecting NIN details.</strong> There is no way to verify on HeyNaija yet. Nothing on
        this site asks for your NIN, a NIN slip, photos of identity documents or your date of birth. Verification stays
        switched off until an authorised provider, a privacy review and a security review are in place.
      </p>

      <section className="governance-section" aria-labelledby="glance-heading">
        <h2 id="glance-heading" className="section-title">At a glance</h2>
        <dl className="verification-glance">
          <div>
            <dt>Optional to use HeyNaija</dt>
            <dd>Every ordinary feature works without it.</dd>
          </div>
          <div>
            <dt>Required for voting membership</dt>
            <dd>Under the draft, adults need it to join the first electorate, together with an opt-in.</dd>
          </div>
          <div>
            <dt>Separate from the green tick</dt>
            <dd>Verifying does not show a tick by itself; showing it is your choice.</dd>
          </div>
        </dl>
      </section>

      <section id="green-tick" className="governance-section" aria-labelledby="tick-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><VerifiedIcon size={22} /></span>
          <h2 id="tick-heading" className="section-title">The green tick</h2>
          <span className="status-chip is-proposed">Design preview</span>
        </div>
        <div className="badge-preview" aria-label="Design preview of the green tick, not attached to any account">
          <div className="badge-preview-row">
            <IdentityBadge withLabel preview />
            <span className="badge-preview-note">With its label, as it would appear in Settings</span>
          </div>
          <div className="badge-preview-row">
            <IdentityBadge preview />
            <span className="badge-preview-note">Compact, beside a name on a profile. Hover or focus it to read the note.</span>
          </div>
          <p className="badge-preview-tip">“{BADGE_TOOLTIP}”</p>
        </div>
        <div className="vote-scope">
          <div>
            <h3 className="governance-subtitle">It would mean</h3>
            <ul className="governance-list">
              <li>The account holder completed NIN identity verification with an authorised provider.</li>
              <li>The verification is current: not expired, withdrawn or revoked.</li>
              <li>The account holder chose to show it.</li>
            </ul>
          </div>
          <div>
            <h3 className="governance-subtitle">It would not mean</h3>
            <ul className="governance-list">
              <li>That HeyNaija endorses the account or anything it posts.</li>
              <li>That posts are accurate or trustworthy.</li>
              <li>That the person is a Nigerian citizen.</li>
              <li>That the person is a voting member.</li>
            </ul>
          </div>
        </div>
        <p className="governance-copy">
          The tick would only ever come from a real, reviewed verification. It is never given for a name, a bio, a
          follower count or a payment, and nobody has one today.
        </p>
      </section>

      <section id="how-it-would-work" className="governance-section" aria-labelledby="how-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><IdentityIcon size={22} /></span>
          <h2 id="how-heading" className="section-title">How it would work</h2>
          <span className="chip">Coming soon; not collecting NIN details</span>
        </div>
        <ol className="proposal-steps">
          <li>
            <span className="proposal-step-name">You choose to start</span>
            <span>From Settings, after reading exactly what would be shared and why. Nobody is asked to verify in order to post.</span>
          </li>
          <li>
            <span className="proposal-step-name">You approve it with NINAuth</span>
            <span>You are sent to NIMC’s NINAuth service and consent there, with its QR code, share code or sign-in. You never type your NIN into HeyNaija.</span>
          </li>
          <li>
            <span className="proposal-step-name">Our server checks the answer</span>
            <span>NINAuth returns a short-lived code. HeyNaija’s server, not your browser, exchanges it with the provider and checks it is genuine, meant for HeyNaija, unexpired and used only once.</span>
          </li>
          <li>
            <span className="proposal-step-name">Only the result is kept</span>
            <span>Whether verification succeeded, when, when it expires, an over-18 result if the provider may share one, and a private person key if the provider supports one.</span>
          </li>
          <li>
            <span className="proposal-step-name">You decide what is public</span>
            <span>Settings shows that you are verified. The public tick appears only if you switch it on, and voting membership needs a separate opt-in.</span>
          </li>
        </ol>
        <p className="governance-copy">
          Which details NINAuth can actually provide, including an over-18 result and a stable person key, has to be
          confirmed with the provider before any of this is built. Nothing here should be read as a promise that it can.
        </p>
      </section>

      <section className="governance-section" aria-labelledby="data-heading">
        <div className="governance-section-heading">
          <span className="governance-section-icon"><ShieldIcon size={22} /></span>
          <h2 id="data-heading" className="section-title">What HeyNaija would keep, and never keep</h2>
        </div>
        <div className="vote-scope">
          <div>
            <h3 className="governance-subtitle">Kept, in a restricted store</h3>
            <ul className="governance-list">
              <li>The provider used, and the verification status</li>
              <li>When it was verified and when it expires</li>
              <li>An over-18 yes or no, only if the provider is permitted to share it</li>
              <li>A private person key derived from the provider’s pseudonymous identifier, to stop duplicate memberships</li>
              <li>A record of your consent, and an audit trail of changes</li>
            </ul>
          </div>
          <div>
            <h3 className="governance-subtitle">Never kept or shown</h3>
            <ul className="governance-list">
              <li>Your NIN, or a plain hash of it</li>
              <li>Your NIN slip or photos of identity documents</li>
              <li>Your date of birth or legal name</li>
              <li>The provider’s full response or its access tokens</li>
              <li>Anything identifying in logs, analytics, exports or support tickets</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="governance-section" aria-labelledby="duplicates-heading">
        <h2 id="duplicates-heading" className="section-title">Stopping duplicate voting memberships</h2>
        <p className="governance-copy">
          One person, one vote needs a way to recognise the same person across accounts without storing who they are.
          The plan is a private key derived from an identifier the provider gives for each person, combined with a secret
          only HeyNaija holds. If two accounts produce the same key, only one can hold an active voting membership.
        </p>
        <p className="governance-copy">
          This depends on the provider. If NINAuth cannot contractually and technically supply a stable identifier,
          formal voting stays blocked rather than pretending uniqueness is assured. Even the derived key is personal data,
          so its design needs legal review.
        </p>
      </section>

      <section className="governance-section" aria-labelledby="revocation-heading">
        <h2 id="revocation-heading" className="section-title">Withdrawal, expiry, revocation and appeals</h2>
        <ul className="governance-list">
          <li><strong>Withdraw:</strong> you could remove your verification at any time; the tick disappears at once.</li>
          <li><strong>Expiry:</strong> a verification would last for a set period and then need renewing. The period is not decided.</li>
          <li><strong>Revocation:</strong> HeyNaija could revoke a verification obtained by fraud or impersonation, with notice and reasons.</li>
          <li><strong>Correction and merging:</strong> mistakes and moving between accounts would have a documented process.</li>
          <li><strong>Appeals:</strong> any refusal or revocation could be appealed and reviewed by someone not involved in the decision. Disputes are never settled by public vote.</li>
        </ul>
      </section>

      <section className="governance-section" aria-labelledby="before-heading">
        <h2 id="before-heading" className="section-title">Before verification can open</h2>
        <p className="governance-copy">It stays switched off until every one of these is done and published:</p>
        <ul className="governance-list">
          <li>HeyNaija is an approved NINAuth verification partner, with confirmed scopes, pricing and data-sharing terms.</li>
          <li>A data protection impact assessment, reviewed by Nigerian privacy counsel.</li>
          <li>An updated <Link href="/privacy#identity">privacy policy</Link>, with a reviewed retention schedule.</li>
          <li>An independent security review of the integration, and an incident-response plan.</li>
        </ul>
      </section>

      <section id="faq" className="governance-section" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="section-title">Questions</h2>
        <div className="faq-list">
          {faq.map((item) => (
            <details key={item.q} className="faq-item">
              <summary>
                <span>{item.q}</span>
                <ChevronIcon size={16} />
              </summary>
              <div className="faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      <FoundingStageNotice />

      <footer className="governance-footer">
        <p className="text-sm text-muted">Voting membership has its own conditions beyond verification.</p>
        <Link href="/governance/membership" className="btn btn-secondary btn-sm mt-3">Read about voting membership</Link>
      </footer>
    </div>
  )
}
