import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AvatarUploader } from '@/app/ui/avatar-uploader'
import { FlowForm } from '@/app/ui/flow-form'
import { ProfileForm } from '@/app/ui/profile-form'
import { ThemeSwitch } from '@/app/ui/theme-switch'
import { getViewer } from '@/lib/api'
import { getFlow } from '@/lib/kratos'

export const metadata: Metadata = { title: 'Settings' }

export default function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Make yourself at home</p>
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Your public profile, your preferences and the ways you sign in.</p>
      </header>
      <section className="content-panel settings-section" aria-labelledby="photo-heading">
        <div>
          <h2 id="photo-heading" className="section-title">Profile photo</h2>
          <p className="field-hint mt-1">Help people recognise you in the conversation.</p>
        </div>
        <Suspense fallback={<div className="skeleton h-[72px] w-64" />}>
          <ProfilePhoto />
        </Suspense>
      </section>
      <section className="content-panel settings-section" aria-labelledby="profile-heading">
        <div>
          <h2 id="profile-heading" className="section-title">Name and bio</h2>
          <p className="field-hint mt-1">A little about you. These details are public.</p>
        </div>
        <Suspense fallback={<div className="skeleton h-48" />}>
          <NameAndBio />
        </Suspense>
      </section>
      <section className="content-panel settings-section" aria-labelledby="appearance-heading">
        <h2 id="appearance-heading" className="section-title">Appearance</h2>
        <ThemeSwitch />
        <p className="field-hint">System follows your device. This choice is saved on this device only.</p>
      </section>
      <div className="content-panel settings-section">
        <p className="page-eyebrow">Account access</p>
        <Suspense fallback={<div aria-busy="true" className="skeleton h-48" />}>
          <SettingsForm searchParams={searchParams} />
        </Suspense>
      </div>
      <Link href="/" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-accent-strong hover:underline">
        Back to the feed
      </Link>
    </div>
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
  return <FlowForm flow={flow} sections={{ profile: 'Email and handle', oidc: 'Connected accounts' }} />
}
