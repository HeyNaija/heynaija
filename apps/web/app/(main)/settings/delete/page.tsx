import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { CancelDeletionForm } from '@/app/ui/cancel-deletion-form'
import { DeleteAccountForm } from '@/app/ui/delete-account-form'
import { LocalTime } from '@/app/ui/local-time'
import { getAccountDeletion } from '@/lib/api'

export const metadata: Metadata = { title: 'Delete your account' }

const linkClass = 'font-semibold text-accent-strong hover:underline'
const listClass = 'flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed'
const stepsClass = 'flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed'

/**
 * What deleting an account does, and the form that does it (docs/adr/0016). The
 * form is outside every <Suspense>, so it is in the first HTML and works without
 * JavaScript; only the grace period and notices about this member stream in.
 */
export default function DeleteAccountPage({ searchParams }: PageProps<'/settings/delete'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Settings</p>
        <h1 className="page-title">Delete your account</h1>
        <p className="page-description">
          Your account leaves HeyNaija straight away, and is erased after a grace period unless you change your mind.
        </p>
      </header>
      <Suspense fallback={null}>
        <Notices searchParams={searchParams} />
      </Suspense>
      <section className="content-panel settings-section" aria-labelledby="happens-heading">
        <h2 id="happens-heading" className="section-title">What happens</h2>
        <ol className={stepsClass}>
          <li>At once, your profile, posts and replies disappear from HeyNaija, and you are signed out on every device.</li>
          <li>
            For{' '}
            <Suspense fallback="a grace period">
              <GracePeriod />
            </Suspense>{' '}
            nothing is erased. Sign in during that time and you can keep your account.
          </li>
          <li>Then your account is erased. This cannot be undone.</li>
        </ol>
      </section>
      <section className="content-panel settings-section" aria-labelledby="erased-heading">
        <h2 id="erased-heading" className="section-title">What is erased</h2>
        <ul className={listClass}>
          <li>Your name, bio and profile photo.</li>
          <li>Your email address and the ways you sign in.</li>
          <li>The text and images of your posts and replies.</li>
          <li>Your likes, reposts, bookmarks and idea votes.</li>
          <li>Who you follow, block and mute, and the communities you joined.</li>
          <li>Your notifications, your notification settings and your age record.</li>
        </ul>
      </section>
      <section className="content-panel settings-section" aria-labelledby="kept-heading">
        <h2 id="kept-heading" className="section-title">What is kept, and why</h2>
        <ul className={listClass}>
          <li>
            A blank placeholder, shown as @deleted-…, in place of your account, so other people’s conversations and
            reports still make sense. Your handle is held for 30 days, so nobody can take it straight away.
          </li>
          <li>Other people’s replies to your posts. Your posts show as no longer available.</li>
          <li>
            Posts of yours that were reported or taken down, kept privately as the record of moderation decisions and
            blanked later, and the reports and decisions themselves.
          </li>
          <li>A record that you asked for your account to be deleted, and when that was done.</li>
          <li>Backups, which age out within 30 days, and copies of sign-in emails, kept for 7 days.</li>
        </ul>
        <p className="field-hint">
          <Link href="/privacy#keep" className={linkClass}>How long we keep things</Link>
        </p>
      </section>
      <section className="content-panel settings-section" aria-labelledby="first-heading">
        <div>
          <h2 id="first-heading" className="section-title">Before you go</h2>
          <p className="field-hint mt-1">Download your data first: it comes as one file you can keep.</p>
        </div>
        {/* A plain link: the browser saves the file, with or without JavaScript. */}
        <a href="/settings/export" className="btn btn-secondary self-start" download>
          Download your data
        </a>
      </section>
      <section className="content-panel settings-section" aria-labelledby="confirm-heading">
        <div>
          <h2 id="confirm-heading" className="section-title">Delete your account</h2>
          <p className="field-hint mt-1">
            If you signed in more than 15 minutes ago, you will be asked to sign in again first.
          </p>
        </div>
        <DeleteAccountForm />
      </section>
      <Link href="/settings" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-accent-strong hover:underline">
        Back to Settings
      </Link>
    </div>
  )
}

async function GracePeriod() {
  const deletion = await getAccountDeletion()
  return deletion?.state === 'none' ? `${deletion.graceDays} days` : 'a grace period'
}

/** Back from signing in again, or already waiting for deletion. */
async function Notices({ searchParams }: Pick<PageProps<'/settings/delete'>, 'searchParams'>) {
  const [deletion, params] = await Promise.all([getAccountDeletion(), searchParams])
  if (deletion?.state === 'scheduled') {
    return (
      <div role="status" className="notice flex flex-col gap-3">
        <p>
          Your account is already being deleted. It will be erased on{' '}
          <LocalTime at={deletion.scheduledFor} as="date" />.
        </p>
        <CancelDeletionForm />
      </div>
    )
  }
  if (params.signed_in) {
    return <p role="status" className="notice">You signed in again. Type your handle below once more to delete your account.</p>
  }
  return null
}
