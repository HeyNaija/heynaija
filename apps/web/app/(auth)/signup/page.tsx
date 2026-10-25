import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { AGE_COOKIE, INVITE_COOKIE } from '@/lib/invite'
import { AuthForm } from '@/lib/auth/server'

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
  // The invite code and the age confirmation travel in cookies set on /join;
  // Kratos hands them to our API.
  const jar = await cookies()
  if (!jar.has(INVITE_COOKIE) || !jar.has(AGE_COOKIE)) redirect('/join')
  return <AuthForm kind="registration" flowId={(await searchParams).flow} />
}
