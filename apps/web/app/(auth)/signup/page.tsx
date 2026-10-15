import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { INVITE_COOKIE } from '@/lib/invite'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Create your account' }

export default function SignupPage({ searchParams }: PageProps<'/signup'>) {
  return (
    <AuthPage
      eyebrow="Make yourself at home"
      title="Create your account"
      intro="Choose your public handle. Your email stays private, and a sign-in code takes the place of a password."
      footer={
        <>
          <p>
            Before you join, read the{' '}
            <Link href="/rules" className={linkClass}>rules</Link> and the{' '}
            <Link href="/privacy" className={linkClass}>privacy policy</Link>.
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
      <SignupForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function SignupForm({ searchParams }: Pick<PageProps<'/signup'>, 'searchParams'>) {
  // The invite code travels in a cookie set on /join; Kratos hands it to our API.
  if (!(await cookies()).has(INVITE_COOKIE)) redirect('/join')
  const flow = await getFlow('registration', (await searchParams).flow)
  return <FlowForm flow={flow} />
}
