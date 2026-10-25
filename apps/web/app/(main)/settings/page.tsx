import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AvatarUploader } from '@/app/ui/avatar-uploader'
import { IdentityBadge } from '@/app/ui/identity-badge'
import { InstallApp } from '@/app/ui/install-app'
import { NotificationPreferencesForm } from '@/app/ui/notification-preferences-form'
import { ProfileForm } from '@/app/ui/profile-form'
import { PushSwitch } from '@/app/ui/push-switch'
import { ThemeSwitch } from '@/app/ui/theme-switch'
import { type GovernanceStatus, getGovernanceStatus, getNotificationPreferences, getPushKey, getViewer } from '@/lib/api'
import { AuthForm } from '@/lib/auth/server'

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
      <section className="content-panel settings-section" aria-labelledby="notifications-heading">
        <div>
          <h2 id="notifications-heading" className="section-title">Notifications</h2>
          <p className="field-hint mt-1">Choose which activity from other members notifies you, and how it reaches you.</p>
        </div>
        <Suspense fallback={<div aria-busy="true" className="skeleton h-[46rem]" />}>
          <NotificationSettings />
        </Suspense>
      </section>
      <div className="content-panel settings-section">
        <p className="page-eyebrow">Account access</p>
        <Suspense fallback={<div aria-busy="true" className="skeleton h-48" />}>
          <SettingsForm searchParams={searchParams} />
        </Suspense>
      </div>
      <section className="content-panel settings-section" aria-labelledby="governance-heading">
        <div>
          <h2 id="governance-heading" className="section-title">Identity and governance</h2>
          <p className="field-hint mt-1">
            Your age on record, optional NIN verification and voluntary online voting status. Legal association
            membership requires separate formal admission. You never need NIN verification for ordinary social use.
          </p>
        </div>
        <Suspense fallback={<div aria-busy="true" className="skeleton h-40" />}>
          <GovernanceStanding />
        </Suspense>
      </section>
      <section className="content-panel settings-section" aria-labelledby="data-heading">
        <div>
          <h2 id="data-heading" className="section-title">Your data</h2>
          <p className="field-hint mt-1">
            Download everything HeyNaija holds about you: your profile, posts, likes, bookmarks, who you
            follow, mutes and blocks, your notification settings and reports you made. It comes as one JSON file.{' '}
            <Link href="/privacy" className="font-semibold text-accent-strong hover:underline">How we use your data</Link>
          </p>
        </div>
        <Suspense fallback={null}>
          <ExportNotice searchParams={searchParams} />
        </Suspense>
        {/* A plain link: the browser saves the file, with or without JavaScript. */}
        <a href="/settings/export" className="btn btn-secondary self-start" download>
          Download your data
        </a>
      </section>
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

async function NotificationSettings() {
  const viewer = await getViewer()
  if (viewer.state !== 'member') return null
  const [preferences, pushKey] = await Promise.all([getNotificationPreferences(), getPushKey()])
  if (!preferences) {
    return <p role="alert" className="notice">Your notification settings could not be loaded just now. Try again in a few minutes.</p>
  }
  return (
    <>
      {/* Only where the server can push (it has VAPID keys). */}
      {pushKey ? <PushSwitch publicKey={pushKey} /> : null}
      {/* Only where the browser offers it (Chrome, Edge, Samsung Internet); on an iPhone, PushSwitch explains. */}
      <InstallApp />
      <NotificationPreferencesForm preferences={preferences} />
    </>
  )
}

/** The member's age on record, in words. Unknown is said plainly, never shown as adult. */
function ageLabel({ band, assurance }: GovernanceStatus['age']): { value: string; detail: string } {
  if (band === 'unknown') {
    return {
      value: 'Not on record',
      detail: 'There is no age on record for your account, usually because it was made before HeyNaija asked. It is not treated as a confirmed adult.',
    }
  }
  const age = band === '18_plus' ? '18 or older' : 'Under 18'
  if (assurance === 'verified') return { value: `${age}, verified`, detail: 'Confirmed by an age or identity check.' }
  if (assurance === 'reviewed') return { value: age, detail: 'Decided by a moderator. You can appeal it.' }
  return { value: age, detail: 'You confirmed this yourself when you joined. It is not a verified age.' }
}

const verificationLabel: Record<GovernanceStatus['verification']['status'], string> = {
  none: 'Not verified',
  pending: 'Checking',
  verified: 'Verified',
  rejected: 'Not verified',
  expired: 'Expired',
  revoked: 'Withdrawn or revoked',
}

const membershipLabel: Record<GovernanceStatus['membership']['status'], string> = {
  none: 'Not a voting member',
  pending: 'Waiting for checks',
  active: 'Voting member',
  suspended: 'Suspended',
  resigned: 'Online voting deactivated',
}

/** What the API knows about the member's verification and membership, in words. */
async function GovernanceStanding() {
  const viewer = await getViewer()
  if (viewer.state !== 'member') return null
  const status = await getGovernanceStatus()
  if (!status) {
    return <p role="alert" className="notice">Your status could not be loaded just now. Try again in a few minutes.</p>
  }
  const linkClass = 'font-semibold text-accent-strong hover:underline'
  const age = ageLabel(status.age)
  return (
    <dl className="settings-status">
      <div>
        <dt>Age</dt>
        <dd>
          <p className="settings-status-value">{age.value}</p>
          <p>{age.detail} Your age is never shown on your profile.</p>
        </dd>
      </div>
      <div>
        <dt>Identity verification</dt>
        <dd>
          <p className="settings-status-value">{verificationLabel[status.verification.status]}</p>
          {status.verification.open ? null : (
            <p>Verification has not opened. HeyNaija is not collecting NIN details.</p>
          )}
          <Link href="/governance/verification" className={linkClass}>How verification would work</Link>
        </dd>
      </div>
      <div>
        <dt>Green identity tick</dt>
        <dd>
          {status.badge.shown ? (
            <p className="settings-status-value">Shown on your profile <IdentityBadge withLabel /></p>
          ) : (
            <p className="settings-status-value">Not shown</p>
          )}
          <p>Only possible after verification, and only if you choose to show it.</p>
        </dd>
      </div>
      <div>
        <dt>Voting membership</dt>
        <dd>
          <p className="settings-status-value">{membershipLabel[status.membership.status]}</p>
          {status.membership.registrationOpen ? null : <p>Voting membership registration has not opened.</p>}
          <Link href="/governance/membership" className={linkClass}>What voting membership means</Link>
        </dd>
      </div>
    </dl>
  )
}

/** Why the last download did not happen, when it did not. */
async function ExportNotice({ searchParams }: Pick<PageProps<'/settings'>, 'searchParams'>) {
  const state = (await searchParams).export
  if (state === 'busy') {
    return <p role="alert" className="notice">You have downloaded your data several times this hour. Try again in an hour.</p>
  }
  if (state === 'failed') {
    return <p role="alert" className="notice notice-danger">Your data could not be prepared just now. Try again in a few minutes.</p>
  }
  return null
}

async function SettingsForm({ searchParams }: Pick<PageProps<'/settings'>, 'searchParams'>) {
  return <AuthForm kind="settings" flowId={(await searchParams).flow} />
}
