import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactEmail, Placeholder, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  return (
    <PolicyPage
      eyebrow="Your data"
      title="Privacy policy"
      summary="What HeyNaija collects, what is public and what is not, who helps us run the service, how long we keep things, and how you get your data or have it deleted. No ads, no selling data, no trackers."
      updated="6 November 2026"
      sections={[
        {
          id: 'who',
          title: 'Who runs HeyNaija',
          body: (
            <p>
              HeyNaija is run by <Placeholder>operator name and address</Placeholder>, the “data controller”
              under the Nigeria Data Protection Act 2023. For anything about your data, write to{' '}
              <ContactEmail />.
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
                <strong>Private:</strong> your email address, your date of birth and age, your bookmarks, who you mute
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
              <dt>Your date of birth and age</dt>
              <dd>
                The date of birth you give when you join, which you confirm is your real one, and the age band it gives
                (under 18, or 18 or older), kept apart from your account. We do not ask for any identity document to
                join.
              </dd>
              <dt>Your profile</dt>
              <dd>Display name, bio and profile photo, when you add them.</dd>
              <dt>What you post</dt>
              <dd>
                Posts, replies and images. Images are re-encoded when you upload them, which removes
                location and camera data stored inside the file.
              </dd>
              <dt>What you do</dt>
              <dd>Likes, bookmarks, follows, mutes, blocks, communities you join, reports and appeals, and your votes on the ideas board.</dd>
              <dt>Problem reports</dt>
              <dd>
                When you report a problem on the ideas board: the page you reported it from, your browser’s description of
                itself and the version of HeyNaija that was running. Only you and Building HeyNaija’s moderators see these;
                the report itself is a public post.
              </dd>
              <dt>Push notifications</dt>
              <dd>
                If you turn them on in a browser: the address its push service gave it, the keys that encrypt what is
                sent there, and when it last got one. Turning push off, or signing out there, deletes them.
              </dd>
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
                <li>If you turn on push notifications in a browser, to show your notifications there as they happen. What reaches you that way is not emailed as well.</li>
              </ul>
              <p>
                Latest and Following are in time order. <Link href="/about/discover">Discover</Link> ranks recent
                posts by published rules, using only public activity (replies, quotes, reposts and like counts), who
                you follow and which communities you joined. We do not record what you read, rank posts by guessing
                what you will engage with, show advertising, or sell or rent your data to anyone.
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
                <li>
                  <strong>Your browser’s push service</strong>, only if you turn on push notifications: Google for Chrome
                  and most Android browsers, Apple for Safari, Mozilla for Firefox, Microsoft for Edge on Windows. It
                  carries them to your device encrypted, so it cannot read them, but it does see when they are sent.
                </li>
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
              <li><code>hn_age</code>: holds the date of birth you typed while you sign up, until your account exists, and for up to an hour.</li>
              <li><code>hn_age_refused</code>: if you cannot join yet because of your age, records only that, for a day.</li>
              <li>A security cookie from our sign-in service, which stops other sites submitting forms as you.</li>
              <li><code>hn_feed</code>: which tab you last chose on Home (Discover, Latest or Following), so Home opens on it, for up to a year.</li>
              <li><code>hn_deletion</code>: the date your account will be erased, shown to you once you ask for it to be deleted, for an hour.</li>
              <li><code>hn_data</code>: whether you chose to save data (Automatic, Save data or Always load), so pictures can be held back until you tap them, for up to a year.</li>
              <li>Your light or dark theme is saved in your browser, not sent to us.</li>
            </ul>
          ),
        },
        {
          id: 'keep',
          title: 'How long we keep it',
          body: (
            <>
              <ul>
                <li>Your account, profile, date of birth and age: for as long as you have an account.</li>
                <li>
                  Posts you delete leave every page at once, but the record is kept for{' '}
                  <Placeholder>period</Placeholder> so moderation decisions can be checked.
                </li>
                <li>Images that were never posted: removed within a few hours.</li>
                <li>
                  Images moderators take down are moved out of public view and kept privately as evidence for{' '}
                  <Placeholder>period, to be confirmed by counsel</Placeholder>.
                </li>
                <li>
                  Backups of our two databases (HeyNaija’s, and the sign-in service’s): kept for 30 days, encrypted.
                  Something deleted stays in them until they age out.
                </li>
                <li>Copies of the emails our sign-in service sends you, such as sign-in codes: 7 days.</li>
                <li>Server logs: <Placeholder>period</Placeholder>.</li>
              </ul>
              <p>
                <strong>When you delete your account</strong>, it leaves HeyNaija at once and is erased 14 days later.
                Erasing removes your email address and the ways you sign in, your name, bio and photo, the text and
                images of your posts and replies, your likes, reposts, bookmarks and votes, who you follow, block and
                mute, your community memberships and notifications, and your age record. What stays:
              </p>
              <ul>
                <li>
                  A blank placeholder, shown as @deleted-…, in place of your account, so other people’s conversations
                  and reports still make sense. Your handle is held for 30 days so nobody can take it straight away.
                </li>
                <li>Other people’s replies to your posts. Your posts show as no longer available.</li>
                <li>
                  Posts of yours that were reported or taken down, out of public view, as the record of moderation
                  decisions, for the period above, and the reports and decisions themselves.
                </li>
                <li>
                  A record that you declared you were 18 or older, and when, linked only to that placeholder, for{' '}
                  <Placeholder>period, to be confirmed by counsel</Placeholder>.
                </li>
                <li>
                  The record that you asked for your account to be deleted, and when it was done, for{' '}
                  <Placeholder>period, to be confirmed by counsel</Placeholder>.
                </li>
              </ul>
            </>
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
                <strong>Delete your account:</strong> in{' '}
                <Link href="/settings/delete">Settings → Delete your account</Link>. It leaves HeyNaija at once and is
                erased after 14 days; until then you can sign in and keep it. <Link href="#keep">What is kept</Link>.
              </li>
              <li>
                <strong>Anything else</strong>, or if you cannot use Settings: write to <ContactEmail /> from the
                address you sign in with. We answer within 30 days.
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
                activate voting as eligible legal members. Formal association admission is separate; verification does not grant membership. It would be opt-in, and HeyNaija would keep only the result: the status, its
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
                you give your date of birth and confirm that it is your real one; accounts for anyone younger are not
                allowed yet, and nobody under 13 can ever join. See the{' '}
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
                With it we keep the date of birth you gave, so that if an age in the rules changes your band can be
                worked out again without asking you, and so a later age check can be compared with what you said. Only
                you can see your date of birth, in Settings and in your data export; moderators see at most whether an
                account is an adult. It is never logged, never shown on your profile, and deleted with your account.
                You cannot change it yourself: to correct it, write to <ContactEmail />. Accounts made before 16 October
                2026 have no age on record and are not treated as confirmed adults.
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
