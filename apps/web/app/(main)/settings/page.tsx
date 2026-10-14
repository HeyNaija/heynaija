import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { AvatarUploader } from '@/app/ui/avatar-uploader'
import { FlowForm } from '@/app/ui/flow-form'
import { ProfileForm } from '@/app/ui/profile-form'
import { ThemeSwitch } from '@/app/ui/theme-switch'
import { getViewer } from '@/lib/api'
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
        <h2 className="section-title">Profile photo</h2>
        <Suspense fallback={<div className="skeleton h-[72px] w-64" />}>
          <ProfilePhoto />
        </Suspense>
      </section>
      <section className="mb-6 flex flex-col gap-3 border-b border-line pb-6">
        <h2 className="section-title">Name and bio</h2>
        <Suspense fallback={<div className="skeleton h-48" />}>
          <NameAndBio />
        </Suspense>
      </section>
      <section className="mb-6 flex flex-col gap-3 border-b border-line pb-6">
        <h2 className="section-title">Appearance</h2>
        <ThemeSwitch />
        <p className="field-hint">System follows your device. This choice is saved on this device only.</p>
      </section>
      <SettingsForm searchParams={searchParams} />
    </AuthPage>
  )
}

async function ProfilePhoto() {
  const viewer = await getViewer()
  if (viewer.state !== 'member') return null
  return <AvatarUploader handle={viewer.me.handle} avatar={viewer.me.avatar} />
}

async function NameAndBio() {
  const viewer = await getViewer()
  if (viewer.state !== 'member') return null
  return <ProfileForm displayName={viewer.me.displayName} bio={viewer.me.bio} />
}

async function SettingsForm({ searchParams }: Pick<PageProps<'/settings'>, 'searchParams'>) {
  const flow = await getFlow('settings', (await searchParams).flow)
  return <FlowForm flow={flow} sections={{ profile: 'Profile', password: 'Change password' }} />
}
