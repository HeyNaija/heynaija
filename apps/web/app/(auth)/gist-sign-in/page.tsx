import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { signInUrl } from '@/lib/auth/server'
import { gistReturnPath } from '@/lib/gists-gate'
import { defaultPreviewImage, siteOpenGraph, siteOrigin } from '@/lib/previews'

type Props = PageProps<'/gist-sign-in'>

// proxy.ts shows this at a Gist's own address to anyone signed out while Gists are
// on (docs/adr/0017 section 4a). It is the same for every Gist address, real or not,
// so a link pasted into WhatsApp or X (whose preview fetchers are signed out) says
// what a Gist is and nothing about this one: no title, host or live state.

const title = 'A Gist on HeyNaija'
const description = 'A live audio conversation between HeyNaija members. Sign in to listen.'

// Built per request, so the picture's address is the site's, not the build machine's.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const to = gistReturnPath((await searchParams).to)
  return {
    title: { absolute: title },
    description,
    // Any Gist address shows this page, so none of them belongs in search results.
    robots: { index: false },
    openGraph: { ...siteOpenGraph, type: 'website', title, description, url: to ?? undefined, images: [defaultPreviewImage] },
    twitter: { card: 'summary_large_image' },
  }
}

export default function GistSignInPage({ searchParams }: Props) {
  return (
    <AuthPage
      eyebrow="Gists"
      title="Sign in to join this Gist"
      intro="Gists are live audio conversations between HeyNaija members. Sign in and you’ll come straight back here."
      footer={
        <p>
          New here? HeyNaija is invite-only during the beta.{' '}
          <Link href="/join" className={linkClass}>
            I have an invite code
          </Link>
        </p>
      }
    >
      <SignInLink searchParams={searchParams} />
    </AuthPage>
  )
}

async function SignInLink({ searchParams }: Pick<Props, 'searchParams'>) {
  const to = gistReturnPath((await searchParams).to)
  if (!to) notFound()
  return (
    <a href={signInUrl(new URL(to, siteOrigin).href)} className="btn btn-primary btn-lg btn-block">
      Sign in
    </a>
  )
}
