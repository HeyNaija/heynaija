import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { getFlow, getLogoutUrl, getSessionEmail } from '@/lib/kratos'

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
  if (!flow.refresh) return <FlowForm flow={flow} />

  // Already signed in, confirming it is them before a change in Settings.
  const [email, logoutUrl] = await Promise.all([getSessionEmail(), getLogoutUrl()])
  return (
    <div className="flex flex-col gap-5">
      <FlowForm flow={flow} identifier={email ?? undefined} />
      {logoutUrl ? (
        <p className="text-sm text-muted">
          Not you?{' '}
          <a href={`/logout?to=${encodeURIComponent(logoutUrl)}`} className={linkClass}>
            Sign out
          </a>
        </p>
      ) : null}
    </div>
  )
}
