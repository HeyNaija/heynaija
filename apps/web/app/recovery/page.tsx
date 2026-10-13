import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Recover your account' }

export default function RecoveryPage({ searchParams }: PageProps<'/recovery'>) {
  return (
    <AuthPage
      title="Recover your account"
      intro="Enter the email you signed up with. If it matches an account, we will send a code to get you back in."
      footer={
        <p>
          <Link href="/login" className={linkClass}>
            Back to sign in
          </Link>
        </p>
      }
    >
      <RecoveryForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function RecoveryForm({ searchParams }: Pick<PageProps<'/recovery'>, 'searchParams'>) {
  const flow = await getFlow('recovery', (await searchParams).flow)
  return <FlowForm flow={flow} />
}
