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
      title="Create your account"
      intro="Your handle is your public name on HeyNaija. Your email stays private."
      footer={
        <p>
          Already a member?{' '}
          <Link href="/login" className={linkClass}>
            Sign in
          </Link>
        </p>
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
