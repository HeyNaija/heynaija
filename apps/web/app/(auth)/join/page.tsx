import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { getJoinAge } from '@/lib/api'
import { JoinForm } from './join-form'

export const metadata: Metadata = { title: 'Join' }

export default function JoinPage({ searchParams }: PageProps<'/join'>) {
  return (
    <AuthPage
      eyebrow="You're invited"
      title="Your conversation starts here"
      intro="During the beta, HeyNaija is invite-only. Enter your invite code and your date of birth to create an account."
      footer={
        <>
          <p>
            Who can join, and why? Read the <Link href="/rules#age" className={linkClass}>rules</Link> and the{' '}
            <Link href="/privacy#age" className={linkClass}>privacy policy</Link>.
          </p>
          <p className="mt-2">
            Already a member?{' '}
            <Link href="/login" className={linkClass}>
              Sign in
            </Link>
          </p>
        </>
      }
    >
      <Prefilled searchParams={searchParams} />
    </AuthPage>
  )
}

// Invite links look like /join?code=HN-XXXX-XXXX-XXXX. Who may join is the
// API's to say (18 now, 13 once under-18 accounts open), so it streams in with the form.
async function Prefilled({ searchParams }: Pick<PageProps<'/join'>, 'searchParams'>) {
  const [{ code }, joinAge] = await Promise.all([searchParams, getJoinAge()])
  return (
    <>
      <p className="mb-5 text-sm leading-6 text-muted">HeyNaija is open to people aged {joinAge} and over.</p>
      <JoinForm initialCode={typeof code === 'string' ? code.slice(0, 40) : ''} />
    </>
  )
}
