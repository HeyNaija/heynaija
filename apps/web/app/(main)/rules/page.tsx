import type { Metadata } from 'next'
import Link from 'next/link'
import { Placeholder, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Rules' }

export default function RulesPage() {
  return (
    <PolicyPage
      eyebrow="How we treat each other"
      title="HeyNaija rules"
      summary="HeyNaija is for real conversations between Nigerians, at home and abroad. These rules apply everywhere on the site. Every post is public, so write as you would in a town square."
      updated="15 October 2026"
      sections={[
        {
          id: 'rules',
          title: 'The rules',
          body: (
            <ol>
              <li>
                <strong>Be yourself.</strong> One account per person. Do not pretend to be someone else, or
                to speak for an organisation you do not represent.
              </li>
              <li>
                <strong>No harassment or bullying.</strong> No threats, no targeting or piling on a person,
                and no sharing someone’s private details (phone number, address, workplace) without their
                consent.
              </li>
              <li>
                <strong>No hate.</strong> Do not attack people for their ethnic group, tribe, religion,
                gender, sexuality, disability, or where they come from. Disagree with ideas, not with who
                people are.
              </li>
              <li>
                <strong>No spam or scams.</strong> No repeated promotion, fake giveaways, schemes to take
                people’s money, or buying and selling followers or accounts.
              </li>
              <li>
                <strong>Nothing illegal.</strong> No calls to violence, no selling illegal goods or
                services, and nothing else that breaks Nigerian law.
              </li>
              <li>
                <strong>Never any sexual content involving children.</strong> It is removed at once, the
                account is suspended without warning, and it is reported to the authorities. Images are
                checked against lists of known abuse material.
              </li>
            </ol>
          ),
        },
        {
          id: 'communities',
          title: 'Community rules',
          body: (
            <p>
              Each <Link href="/c">community</Link> can add rules of its own, shown on its page, and has
              moderators of its own who apply them. Community rules add to these rules; they never
              replace them.
            </p>
          ),
        },
        {
          id: 'your-tools',
          title: 'Looking after yourself',
          body: (
            <ul>
              <li><strong>Mute</strong> someone to stop seeing their posts. They are not told.</li>
              <li>
                <strong>Block</strong> someone so neither of you sees the other’s posts, and they cannot
                follow you.
              </li>
              <li>
                <strong>Report</strong> a post or an account from its menu when it breaks these rules. Only
                moderators see who reported it.
              </li>
            </ul>
          ),
        },
        {
          id: 'enforcement',
          title: 'What moderators do',
          body: (
            <>
              <p>
                Moderators look at every report. Depending on what they find, they can dismiss the
                report, remove the post, remove a profile photo or clear a name and bio, or suspend the
                account. A suspended account cannot post or interact until it is reinstated.
              </p>
              <p>
                You are told when a decision affects you: when your post is removed or restored, when a
                report you made is resolved, and when your account is reinstated. Every decision is kept
                in a permanent record that moderators can see, so decisions can be checked later.
              </p>
            </>
          ),
        },
        {
          id: 'appeals',
          title: 'Appeals',
          body: (
            <p>
              If your account is suspended, you can appeal from the home page: say why the decision
              should be looked at again, and a moderator will review it. Removed posts can be restored
              when a removal was a mistake. If you think a decision is unfair and an appeal did not help,
              write to <Placeholder>safety contact email</Placeholder>.
            </p>
          ),
        },
      ]}
    />
  )
}
