import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <AuthPage
      title="Sign in"
      intro="No password needed: we email you a code, or you can use Google."
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
