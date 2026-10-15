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
      updated="15 October 2026"
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
            </>
          ),
        },
        {
          id: 'path',
          title: 'The path to community ownership',
          body: (
            <>
              <p>These are the steps, in order. None of them has happened yet; each will be announced on the <Link href="/governance">governance page</Link> when it does.</p>
              <ol>
                <li>Publish this charter, reviewed by a lawyer.</li>
                <li>Form a steering group that includes members, with published terms for who serves and for how long.</li>
                <li>Publish voting rules: who can vote, on what, and what a vote decides.</li>
                <li>Open a public treasury: what comes in, what goes out, and why.</li>
                <li>Choose a legal structure through which members can hold ownership, with legal advice.</li>
              </ol>
            </>
          ),
        },
        {
          id: 'changes',
          title: 'Changing this charter',
          body: (
            <p>
              Until the steering group exists, the custodians may change this charter, but only by
              announcing the change on the governance page at least <Placeholder>notice period</Placeholder>{' '}
              before it takes effect, saying what changed and why.
            </p>
          ),
        },
      ]}
    />
  )
}
