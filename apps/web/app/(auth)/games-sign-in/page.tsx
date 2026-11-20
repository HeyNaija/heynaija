import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { signInUrl } from '@/lib/auth/server'
import { gamesReturnPath } from '@/lib/games-gate'
import { defaultPreviewImage, siteOpenGraph, siteOrigin } from '@/lib/previews'

type Props = PageProps<'/games-sign-in'>

// proxy.ts shows this at a Games address (/games/...) to anyone signed out
// (docs/deployment/app-links.md): sign in, then straight back to that address. It is
// the same for every Games address, so a link pasted into WhatsApp or X (whose
// preview fetchers are signed out) says what Games is and nothing about the round or game.

const title = 'Games on HeyNaija'
const description = 'Chess, Trivia and more with other HeyNaija members. Sign in to play.'

// Built per request, so the picture's address is the site's, not the build machine's.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const to = gamesReturnPath((await searchParams).to)
  return {
    title: { absolute: title },
    description,
    // Every Games address shows this page to someone signed out, so none belongs in search results.
    robots: { index: false },
    openGraph: { ...siteOpenGraph, type: 'website', title, description, url: to ?? undefined, images: [defaultPreviewImage] },
    twitter: { card: 'summary_large_image' },
  }
}

export default function GamesSignInPage({ searchParams }: Props) {
  return (
    <AuthPage
      eyebrow="Games"
      title="Sign in to play"
      intro="Games are for HeyNaija members. Sign in and you’ll come straight back here."
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
  const to = gamesReturnPath((await searchParams).to)
  if (!to) notFound()
  return (
    <a href={signInUrl(new URL(to, siteOrigin).href)} className="btn btn-primary btn-lg btn-block">
      Sign in
    </a>
  )
}
