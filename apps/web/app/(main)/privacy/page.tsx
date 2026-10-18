import type { Metadata } from 'next'
import Link from 'next/link'
import { Placeholder, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Your data"
      title="Privacy policy"
      summary="What HeyNaija collects, what is public and what is not, who helps us run the service, how long we keep things, and how you get your data or have it deleted. No ads, no selling data, no trackers."
      updated="18 October 2026"
      sections={[
        {
          id: 'who',
          title: 'Who runs HeyNaija',
          body: (
            <p>
              HeyNaija is run by <Placeholder>operator name and address</Placeholder>, the “data controller”
              under the Nigeria Data Protection Act 2023. For anything about your data, write to{' '}
              <Placeholder>privacy contact email</Placeholder>.
            </p>
          ),
        },
        {
          id: 'public',
          title: 'What is public, and what is not',
          body: (
            <>
              <p>
                <strong>Public to anyone, signed in or not:</strong> your posts and replies, any images on
                them and their descriptions, the communities they are posted in, your handle, display name,
                bio and profile photo, the date you joined, and how many posts, followers and followings
                you have. Anyone can see and copy what is public.
              </p>
              <p>
                <strong>Private:</strong> your email address, your age confirmation, your bookmarks, who you mute
                and block, your notifications, and the reports you make. Moderators see who made a report; the
                person reported does not.
              </p>
            </>
          ),
        },
        {
          id: 'collect',
          title: 'What we collect',
          body: (
            <dl>
              <dt>Your account</dt>
              <dd>Your email address, handle, and the invite you joined with. If you sign in with Google, Google tells us your email address.</dd>
              <dt>Your age confirmation</dt>
              <dd>
                That you confirmed you are 18 or older when you joined, and when, kept as an age band apart from your
                account. We do not ask for your date of birth or any identity document.
              </dd>
              <dt>Your profile</dt>
              <dd>Display name, bio and profile photo, when you add them.</dd>
              <dt>What you post</dt>
              <dd>
                Posts, replies and images. Images are re-encoded when you upload them, which removes
                location and camera data stored inside the file.
              </dd>
              <dt>What you do</dt>
              <dd>Likes, bookmarks, follows, mutes, blocks, communities you join, reports and appeals.</dd>
              <dt>Technical data</dt>
              <dd>
                When you were last active, and the short-lived logs our servers and Cloudflare keep to run
                the service and protect it, which include IP addresses.
              </dd>
            </dl>
          ),
        },
        {
          id: 'use',
          title: 'How we use it',
          body: (
            <>
              <ul>
                <li>To run HeyNaija: show posts, deliver notifications, sign you in.</li>
                <li>To keep it safe: rate limits, moderation, and checking images against lists of known child abuse material.</li>
                <li>To email you sign-in codes and account messages, and, if notification emails are on for you, a short email when there is something new for you (grouped, at most about twice an hour). Every one has a link that turns them off. We send no newsletters or marketing.</li>
              </ul>
              <p>
                Feeds are in time order. We do not rank posts by guessing what you will engage with, show
                advertising, or sell or rent your data to anyone.
              </p>
            </>
          ),
        },
        {
          id: 'processors',
          title: 'Who helps us run it',
          body: (
            <>
              <p>These companies handle data for us, only to provide their service:</p>
              <ul>
                <li><strong>Cloudflare</strong>: the network in front of the site, security, and storage of images (R2). Its abuse-material scanning tool checks images served through it.</li>
                <li><strong>Resend</strong>: sends the emails with your sign-in codes and your notification emails.</li>
                <li><strong>netcup</strong> and <strong>Contabo</strong>: the servers HeyNaija runs on, in <Placeholder>data centre location</Placeholder>.</li>
                <li><strong>Google</strong>: only if you choose to sign in with Google.</li>
              </ul>
              <p>Some of them process data outside Nigeria. <Placeholder>transfer safeguards, to be confirmed by counsel</Placeholder></p>
            </>
          ),
        },
        {
          id: 'cookies',
          title: 'Cookies',
          body: (
            <ul>
              <li><code>hn_session</code>: keeps you signed in, for up to 14 days.</li>
              <li><code>hn_invite</code>: holds your invite code while you sign up, for up to an hour.</li>
              <li><code>hn_age</code>: records that you confirmed you are 18 or older while you sign up, for up to an hour.</li>
              <li>A security cookie from our sign-in service, which stops other sites submitting forms as you.</li>
              <li>Your light or dark theme is saved in your browser, not sent to us.</li>
            </ul>
          ),
        },
        {
          id: 'keep',
          title: 'How long we keep it',
          body: (
            <ul>
              <li>Your account, profile and age confirmation: for as long as you have an account.</li>
              <li>
                Posts you delete leave every page at once, but the record is kept for{' '}
                <Placeholder>period</Placeholder> so moderation decisions can be checked.
              </li>
              <li>Images that were never posted: removed within a few hours.</li>
              <li>
                Images moderators take down are moved out of public view and kept privately as evidence for{' '}
                <Placeholder>period, to be confirmed by counsel</Placeholder>.
              </li>
              <li>Backups: kept for 30 days, encrypted.</li>
              <li>Server logs: <Placeholder>period</Placeholder>.</li>
            </ul>
          ),
        },
        {
          id: 'rights',
          title: 'Your rights',
          body: (
            <ul>
              <li>
                <strong>See your data:</strong> download it any time from{' '}
                <Link href="/settings#data-heading">Settings → Your data</Link>.
              </li>
              <li><strong>Correct it:</strong> change your name, bio, photo, email or handle in Settings.</li>
              <li>
                <strong>Delete your account:</strong> not in the app yet; write to{' '}
                <Placeholder>privacy contact email</Placeholder> and we will delete it within{' '}
                <Placeholder>period</Placeholder>.
              </li>
              <li>
                <strong>Complain:</strong> to us first, and if we do not resolve it, to the Nigeria Data
                Protection Commission.
              </li>
            </ul>
          ),
        },
        {
          id: 'identity',
          title: 'Identity verification (not active)',
          body: (
            <>
              <p>
                <strong>HeyNaija does not collect NINs, NIN slips, photos of identity documents or dates of birth, and
                identity verification is switched off.</strong> Nothing on the site asks for them.
              </p>
              <p>
                The <Link href="/governance/constitution#article-4">draft constitution</Link> proposes optional NIN
                verification through an authorised NINAuth provider, for people who want a green identity tick or to
                become voting members. It would be opt-in, and HeyNaija would keep only the result: the status, its
                dates, an over-18 result where the provider may share one, and a private key that stops one person
                holding two voting memberships. Never the NIN itself. <Link href="/governance/verification">How it would
                work</Link>.
              </p>
              <p>Before it could start, all of these must be done, and this section rewritten to match:</p>
              <ul>
                <li>
                  <strong>A privacy impact review:</strong> a data protection impact assessment of identity processing,
                  reviewed by Nigerian privacy counsel.
                </li>
                <li>The provider authorised, with its data-sharing terms and any transfers outside Nigeria confirmed.</li>
                <li>
                  The lawful basis, exactly what is collected, and how long it is kept:{' '}
                  <Placeholder>retention period for verification results, set after the privacy impact review</Placeholder>.
                </li>
                <li>A security review of the integration.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'age',
          title: 'Age',
          body: (
            <>
              <p>
                During the invite-only beta, accounts are for people aged <strong>18 or older</strong>. When you join,
                you confirm that you are; accounts for anyone younger are not allowed yet. See the{' '}
                <Link href="/rules#age">rules</Link> for what happens if an account seems to belong to someone under 18.
              </p>
              <p>
                This is a temporary restriction for the beta, not a permanent one. If accounts open to younger people
                later, this policy will first say how ages are checked, what parental or guardian consent the law
                requires and how it is given, what is collected from a parent or guardian, and how children’s data is
                protected.
              </p>
              <p>
                We keep your age apart from your account, from identity verification and from voting membership: an age
                band (under 18, or 18 or older), how it was established (you said so, or a check confirmed it), and when.
                Never your date of birth. Accounts made before 16 October 2026 have no age on record and are not treated
                as confirmed adults. Your age is never shown on your profile.
              </p>
            </>
          ),
        },
        {
          id: 'changes',
          title: 'Changes',
          body: (
            <p>
              We will announce changes to this policy on the <Link href="/governance">governance page</Link>{' '}
              before they take effect.
            </p>
          ),
        },
      ]}
    />
  )
}
