import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { getViewer } from '@/lib/api'
import { getLogoutUrl } from '@/lib/auth/server'
import { BirthDateForm } from './birth-date-form'

export const metadata: Metadata = { title: 'Your date of birth' }

// Where the app sends a member who joined before signup asked for a date of
// birth, from every page, until they give it (ADR 0020, section 1). The rules
// and privacy pages are behind the same gate, so what they say about it is here.
export default function BirthDatePage() {
  return (
    <AuthPage
      eyebrow="One more thing"
      title="Add your date of birth"
      intro="HeyNaija now asks everyone for their date of birth. It keeps posts marked 18+ away from people under 18, and keeps younger members safe. You only do this once, and you need to before you carry on."
      footer={
        <>
          <p>It is deleted with your account. If you make a mistake, write to contact@heynaija.ng.</p>
          <Suspense fallback={null}>
            <SignOut />
          </Suspense>
        </>
      }
    >
      <Form />
    </AuthPage>
  )
}

async function Form() {
  const viewer = await getViewer()
  if (viewer.state === 'anonymous') redirect('/login')
  if (viewer.state !== 'member' || !viewer.me.birthDateNeeded) redirect('/')
  return <BirthDateForm />
}

async function SignOut() {
  const logoutUrl = await getLogoutUrl()
  if (!logoutUrl) return null
  return (
    <p>
      Not now?{' '}
      <a href={`/logout?to=${encodeURIComponent(logoutUrl)}`} className={linkClass}>Sign out</a>
    </p>
  )
}
