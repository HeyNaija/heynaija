import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactEmail, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Rules' }

export default function RulesPage() {
  return (
    <PolicyPage
      eyebrow="How we treat each other"
      title="HeyNaija rules"
      summary="HeyNaija is for real conversations between Nigerians, at home and abroad. These rules apply everywhere on the site. Every post is public, so write as you would in a town square."
      updated="8 November 2026"
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
                checked against lists of known abuse material. Our{' '}
                <Link href="/child-safety">child safety standards</Link> say more.
              </li>
            </ol>
          ),
        },
        {
          id: 'sensitive',
          title: 'Sensitive posts',
          body: (
            <>
              <p>Some things may be posted, but must be <strong>marked as sensitive</strong>:</p>
              <ul>
                <li>graphic violence or injury, news footage included;</li>
                <li>nudity that is not sexual;</li>
                <li>sexual talk, without explicit pictures.</li>
              </ul>
              <p>
                When in doubt, mark it. Explicit sexual pictures or video are not allowed anywhere, marked or not. Profile
                photos, names, bios, community photos and Gist titles can never be marked, so nothing sensitive belongs in
                them.
              </p>
              <p>
                To mark a post, tap <strong>Mark as sensitive</strong> under the pictures or video you attach, or choose it
                from the post’s menu afterwards. If you often post such things, Settings can mark everything you post.
              </p>
              <p>
                A post marked sensitive is never shown to anyone under 18, to anyone with no age on record, or to visitors
                who are not signed in. For everyone else its pictures and video are covered until they tap Show,
                unless they choose otherwise in Settings. Moderators can mark a post themselves, and only a moderator can
                take that mark off. Leaving sensitive posts unmarked again and again breaks these rules.
              </p>
              <p>
                A community’s moderators can mark the whole community as sensitive. Everything posted in it is then
                marked, and only signed-in adults can find, see or join it. Only its moderators can take that mark off.
              </p>
            </>
          ),
        },
        {
          id: 'age',
          title: 'Who can join',
          body: (
            <>
              <p>
                During the beta, HeyNaija is open to people aged <strong>18 or older</strong>. Everyone confirms they are
                18 or older when they join. Nobody needs a date of birth, a NIN or any other identity check to have an
                account.
              </p>
              <p>
                <strong>The 18+ rule is temporary, for the beta.</strong> HeyNaija intends to open accounts to younger
                people later, but only once age checks, parental or guardian consent where the law requires it, and
                child-safety protections have been approved and built. Even then, anything marked for adults would stay
                hidden from under-18s, and voting in HeyNaija’s governance would stay 18+.
              </p>
              <p>
                While the beta is 18+, if moderators have good reason to believe an account belongs to someone under 18,
                they may suspend it. You can appeal that like any other suspension. Nobody will be asked to post identity
                documents publicly to prove their age.
              </p>
            </>
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
              <li>
                <strong>Not a member, or reporting for an authority?</strong> Write to <ContactEmail />{' '}
                with a link to the post or account. Never send the image itself, and never send any image
                of a child: the link is enough for us to find it.
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
                report, mark the post as sensitive, remove the post, remove a profile photo or clear a name
                and bio, or suspend the account. A suspended account cannot post or interact until it is
                reinstated.
              </p>
              <p>
                You are told when a decision affects you: when your post is marked sensitive, removed or
                restored, when a report you made is resolved, and when your account is reinstated. Every decision is kept
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
              should be looked at again, and a moderator will review it. Removed posts can be restored,
              and a moderator’s sensitive mark taken off, when the decision was a mistake. If you think a decision is unfair and an appeal did not help,
              write to <ContactEmail />.
            </p>
          ),
        },
        {
          id: 'governance',
          title: 'Rules and community votes',
          body: (
            <p>
              These rules apply today. The <Link href="/governance/constitution">draft constitution</Link>, which is not
              in force, proposes that members could one day vote on how HeyNaija is run, but never on whether a
              particular post is removed or a particular person is suspended. Those decisions stay with moderators,
              under these rules, with appeals.
            </p>
          ),
        },
      ]}
    />
  )
}
