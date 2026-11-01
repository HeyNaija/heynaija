import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { Suspense } from 'react'
import { LocalTime } from '@/app/ui/local-time'
import { DELETION_COOKIE, scheduledDate } from '@/lib/account-deletion'

export const metadata: Metadata = { title: 'Your account will be deleted' }

/**
 * Where a member lands, signed out, once they have asked for their account's
 * deletion. The date comes in a cookie set when they asked; without it, or
 * without JavaScript, the page still says what to do.
 */
export default function DeletionScheduledPage() {
  return (
    <div className="page-stack">
      <section className="content-panel settings-section" aria-labelledby="scheduled-heading">
        <h1 id="scheduled-heading" className="page-title">Your account will be deleted</h1>
        <p className="text-sm leading-relaxed">
          You are signed out everywhere, and your profile and posts are no longer on HeyNaija.{' '}
          <Suspense fallback="It will be erased once the grace period is over.">
            <ErasedOn />
          </Suspense>
        </p>
        <p className="text-sm leading-relaxed">
          Changed your mind? Sign in before then, with the same email address, and choose Keep my account.
        </p>
        <Link href="/login" className="btn btn-secondary self-start">Sign in</Link>
      </section>
    </div>
  )
}

async function ErasedOn() {
  const at = scheduledDate((await cookies()).get(DELETION_COOKIE)?.value)
  if (!at) return 'It will be erased once the grace period is over.'
  return (
    <>
      It will be erased on <LocalTime at={at} as="date" />.
    </>
  )
}
