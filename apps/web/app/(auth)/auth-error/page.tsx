import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { getFlowError } from '@/lib/auth/server'

export const metadata: Metadata = { title: 'Something went wrong' }

export default function AuthErrorPage({ searchParams }: PageProps<'/auth-error'>) {
  return (
    <AuthPage
      eyebrow="Let's get you back in"
      title="This sign-in couldn't be completed"
      footer={
        <p>
          <Link href="/login" className={linkClass}>
            Try signing in again
          </Link>
        </p>
      }
    >
      <ErrorDetail searchParams={searchParams} />
    </AuthPage>
  )
}

async function ErrorDetail({ searchParams }: Pick<PageProps<'/auth-error'>, 'searchParams'>) {
  const { id } = await searchParams
  const reason = typeof id === 'string' ? await getFlowError(id) : null
  return <p className="text-sm text-muted">{reason ?? 'That link has expired or was already used.'}</p>
}
