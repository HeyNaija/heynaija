import type { Metadata } from 'next'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { FlowForm } from '@/app/ui/flow-form'
import { ThemeSwitch } from '@/app/ui/theme-switch'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  return (
    <AuthPage
      framed
      title="Settings"
      footer={
        <p>
          <Link href="/" className={linkClass}>
            Back to the feed
          </Link>
        </p>
      }
    >
      <section className="mb-6 flex flex-col gap-3 border-b border-line pb-6">
        <h2 className="section-title">Appearance</h2>
        <ThemeSwitch />
        <p className="field-hint">System follows your device. This choice is saved on this device only.</p>
      </section>
      <SettingsForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function SettingsForm({ searchParams }: Pick<PageProps<'/settings'>, 'searchParams'>) {
  const flow = await getFlow('settings', (await searchParams).flow)
  return <FlowForm flow={flow} sections={{ profile: 'Profile', password: 'Change password' }} />
}
