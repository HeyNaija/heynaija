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
      updated="15 October 2026"
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
                <strong>Private:</strong> your email address, your bookmarks, who you mute and block, your
                notifications, and the reports you make. Moderators see who made a report; the person
                reported does not.
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
                <li>To email you sign-in codes and account messages. We send no newsletters or marketing.</li>
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
                <li><strong>Resend</strong>: sends the emails with your sign-in codes.</li>
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
              <li>Your account and profile: for as long as you have an account.</li>
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
          id: 'age',
          title: 'Age',
          body: (
            <p>
              You must be at least <Placeholder>minimum age</Placeholder> to use HeyNaija.
            </p>
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
