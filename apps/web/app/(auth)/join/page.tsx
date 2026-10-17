import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { JoinForm } from './join-form'

export const metadata: Metadata = { title: 'Join' }

export default function JoinPage({ searchParams }: PageProps<'/join'>) {
  return (
    <AuthPage
      eyebrow="You're invited"
      title="Your conversation starts here"
      intro="During the beta, HeyNaija is invite-only and open to people aged 18 or older. Enter your invite code to create an account."
      footer={
        <>
          <p>
            Why 18+? Read the <Link href="/rules#age" className={linkClass}>rules</Link> and the{' '}
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

// Invite links look like /join?code=HN-XXXX-XXXX-XXXX.
async function Prefilled({ searchParams }: Pick<PageProps<'/join'>, 'searchParams'>) {
  const { code } = await searchParams
  return <JoinForm initialCode={typeof code === 'string' ? code.slice(0, 40) : ''} />
}
