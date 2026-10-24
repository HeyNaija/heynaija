import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { AuthForm } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Confirm your email' }

export default function VerificationPage({ searchParams }: PageProps<'/verification'>) {
  return (
    <AuthPage
      eyebrow="One more step"
      title="Confirm your email"
      intro="Confirm your address with a code sent to your email. Your email address stays private."
      footer={
        <p>
          <Link href="/" className={linkClass}>
            Skip for now
          </Link>
        </p>
      }
    >
      <VerificationForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function VerificationForm({ searchParams }: Pick<PageProps<'/verification'>, 'searchParams'>) {
  return <AuthForm kind="verification" flowId={(await searchParams).flow} />
}
