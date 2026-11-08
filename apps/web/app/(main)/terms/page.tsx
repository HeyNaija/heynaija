import type { Metadata } from 'next'
import Link from 'next/link'
import { ContactEmail, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Terms of use' }

export default function TermsPage() {
  return (
    <PolicyPage
      eyebrow="Using HeyNaija"
      title="Terms of use"
      summary="The agreement between you and HeyNaija’s founders when you use HeyNaija: who can use it, what you post and what we may do with it, how accounts end, and the limits of what we promise. It goes with the rules and the privacy policy."
      updated="8 November 2026"
      sections={[
        {
          id: 'agreement',
          title: 'These terms',
          body: (
            <>
              <p>
                HeyNaija is run by its founders (“we”). It is not a registered organisation yet: the{' '}
                <Link href="/governance">governance page</Link> says what is planned.
              </p>
              <p>
                By creating an account or using HeyNaija you agree to these terms, to the{' '}
                <Link href="/rules">rules</Link>, which say how members treat each other and what moderators do, and to
                the way the <Link href="/privacy">privacy policy</Link> says we handle your data. If you do not agree,
                do not use HeyNaija.
              </p>
            </>
          ),
        },
        {
          id: 'who',
          title: 'Who can use HeyNaija',
          body: (
            <ul>
              <li>
                During the beta, HeyNaija is invite-only and open to people aged <strong>18 or older</strong>. You
                confirm you are when you join (<Link href="/rules#age">who can join</Link>).
              </li>
              <li>One account per person. Your account is yours alone: do not sell it, lend it or give it away.</li>
              <li>You may not use HeyNaija while your account is suspended, or where the law does not allow you to.</li>
            </ul>
          ),
        },
        {
          id: 'account',
          title: 'Your account',
          body: (
            <p>
              You sign in with a code we email you, or with Google. Whoever controls your email account can sign in as
              you, so keep it safe. You are responsible for what is done from your account. If you think someone else
              has used it, write to <ContactEmail />.
            </p>
          ),
        },
        {
          id: 'content',
          title: 'What you post',
          body: (
            <>
              <p>
                <strong>What you post stays yours.</strong> So that HeyNaija can work, you give us permission to store,
                copy, show and share it with the people it reaches on HeyNaija, in the sizes and formats the service
                needs (resized images and link previews, for example), anywhere in the world and without payment. The
                permission ends when you delete it or your account, except for what the{' '}
                <Link href="/privacy#keep">privacy policy</Link> says we keep.
              </p>
              <p>
                Most posts are public: anyone can read them, and copy what they read, which we cannot undo. Post only
                what you have the right to share, and nothing that breaks the rules or the law. We do not sell what you
                post, or use it for advertising.
              </p>
            </>
          ),
        },
        {
          id: 'moderation',
          title: 'The rules and moderation',
          body: (
            <p>
              Follow the <Link href="/rules">rules</Link> and the law. Moderators may mark posts as sensitive, remove
              posts, photos, names and bios, and suspend accounts that break them, as the rules describe, and you can
              appeal. We also remove what the law requires us to, and report sexual content involving children to the
              authorities.
            </p>
          ),
        },
        {
          id: 'service',
          title: 'The service',
          body: (
            <>
              <p>
                HeyNaija is in beta: free, without advertising, and still changing. Features may change, pause or stop,
                and the service may sometimes be unavailable. We work to keep it running and your data safe, but we
                provide it as it is, without a promise that it will always be available or free of mistakes.
              </p>
              <p>
                HeyNaija’s code is open source (see the <Link href="/licence">licence</Link>). The HeyNaija name and
                wordmark are not part of that licence: a copy of the code is welcome, but it may not present itself as
                HeyNaija.
              </p>
            </>
          ),
        },
        {
          id: 'ending',
          title: 'Leaving, and suspension',
          body: (
            <p>
              You can delete your account at any time in <Link href="/settings/delete">Settings</Link>; the{' '}
              <Link href="/privacy#keep">privacy policy</Link> says what happens then. We may suspend or close an
              account that breaks these terms, the rules or the law, as the rules describe, with the appeal they give.
              If HeyNaija ever closes, we will announce it on the governance page as early as we can, so members can
              download their data first.
            </p>
          ),
        },
        {
          id: 'limits',
          title: 'Limits',
          body: (
            <p>
              As far as the law allows, we are not responsible for what other members post, for losses that come from
              using HeyNaija or from it being unavailable, or for indirect losses. Nothing in these terms takes away a
              right you have under Nigerian law that cannot be given up, including as a consumer.
            </p>
          ),
        },
        {
          id: 'law',
          title: 'Law and disputes',
          body: (
            <p>
              These terms are governed by the laws of the Federal Republic of Nigeria. If something goes wrong, write to{' '}
              <ContactEmail /> first, and we will try to put it right. If we cannot, the courts of Nigeria decide.
            </p>
          ),
        },
        {
          id: 'changes',
          title: 'Changes',
          body: (
            <p>
              We will announce changes to these terms on the <Link href="/governance">governance page</Link> before
              they take effect. If you keep using HeyNaija after that, the new terms apply to you; if you do not agree
              with them, you can delete your account.
            </p>
          ),
        },
      ]}
    />
  )
}
