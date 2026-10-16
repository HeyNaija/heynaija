import type { Metadata } from 'next'
import Link from 'next/link'
import { Placeholder, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Charter' }

export default function CharterPage() {
  return (
    <PolicyPage
      eyebrow="Our shared future"
      title="HeyNaija charter"
      summary="What HeyNaija is for, the promises it makes to members now, who is responsible for it today, and the steps toward members having a real say in how it is run. It is honest about what has not happened yet."
      updated="16 October 2026"
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
                This charter sets out the promises that apply today. The{' '}
                <Link href="/governance/constitution">draft constitution</Link> proposes how HeyNaija would be governed
                once members can vote: voting membership, a five-member Community Council, ballots and the transfer of
                ownership. It is open for consultation and does not apply until it is lawfully adopted with a published
                effective date. Until then, where the two differ, this charter applies.
              </p>
              <p>
                Proposals in the draft, such as an 18+ rule for voting membership or optional NIN verification, are not
                in force unless this charter, the <Link href="/rules">rules</Link> or the{' '}
                <Link href="/privacy">privacy policy</Link> say so.
              </p>
            </>
          ),
        },
        {
          id: 'promises',
          title: 'Promises we keep today',
          body: (
            <ul>
              <li><strong>Feeds in time order.</strong> Posts are not ranked by what keeps you scrolling, and feeds say why a post is there.</li>
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
                HeyNaija is not community-owned yet. Today it is run, paid for and decided by its
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
                These are the steps the draft constitution proposes, in order (Article 13). Where each one stands is
                shown on the <Link href="/governance#ownership">governance page</Link>, and each will be announced there
                when it is done. Ownership has not transferred, and no poll or vote will be called binding until it has.
              </p>
              <ol>
                <li>Publish the drafts, and who runs HeyNaija.</li>
                <li>Hold a public consultation, with a temporary advisory group that includes members.</li>
                <li>Have the drafts reviewed by Nigerian cooperative, corporate and data-protection lawyers.</li>
                <li>Choose and register a member-controlled Nigerian legal entity.</li>
                <li>Adopt its membership bylaws and hold the first election of the Community Council.</li>
                <li>Transfer the domain, name, core assets and governance control to it, by signed documents.</li>
                <li>Publish independent confirmation that the transfer happened.</li>
              </ol>
              <p>A public treasury opens once money flows, with reports at least every quarter.</p>
            </>
          ),
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
      ]}
    />
  )
}
