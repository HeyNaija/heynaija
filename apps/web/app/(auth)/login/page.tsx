import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <AuthPage
      eyebrow="Welcome back"
      title="Sign in"
      intro="Pick up the conversation. Sign in with an emailed code or your Google account. No password to remember."
      footer={
        <p>
          New here? HeyNaija is invite-only during the beta.{' '}
          <Link href="/join" className={linkClass}>
            I have an invite code
          </Link>
        </p>
      }
    >
      <LoginForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function LoginForm({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const flow = await getFlow('login', (await searchParams).flow)
  return <FlowForm flow={flow} />
}
