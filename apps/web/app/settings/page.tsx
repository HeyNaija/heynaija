import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Account' }

export default function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  return (
    <AuthPage
      title="Account"
      footer={
        <p>
          <Link href="/" className={linkClass}>
            Back to the feed
          </Link>
        </p>
      }
    >
      <SettingsForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function SettingsForm({ searchParams }: Pick<PageProps<'/settings'>, 'searchParams'>) {
  const flow = await getFlow('settings', (await searchParams).flow)
  return <FlowForm flow={flow} sections={{ profile: 'Profile', password: 'Change password' }} />
}
