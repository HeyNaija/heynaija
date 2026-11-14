import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { getViewer } from '@/lib/api'
import { GistDock } from '@/app/ui/gists/gist-dock'
import { GistProvider } from '@/app/ui/gists/gist-provider'
import { BottomNav, RightRail, Sidebar, TopBar } from '@/app/ui/shell'

// The app proper: navigation on the left, the page in the middle, discovery on the
// right. On a phone only the middle column shows, with a bar along the bottom.
// GistProvider holds the Gist the member is in, so it keeps playing from page to
// page; GistDock shows it at the foot of every page but its own.
export default function MainLayout({ children }: LayoutProps<'/'>) {
  return (
    <GistProvider>
      <div className="town-square">
        <Suspense fallback={null}>
          <BirthDateGate />
        </Suspense>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Sidebar />
        <div className="square-content">
          <TopBar />
          <div className="square-columns">
            <main id="main-content" className="square-feed">
              {children}
              {/* It reads the current page (usePathname), which is known only per request. */}
              <Suspense fallback={null}>
                <GistDock />
              </Suspense>
            </main>
            <RightRail />
          </div>
        </div>
        <BottomNav />
      </div>
    </GistProvider>
  )
}

/**
 * Sends a member who has not given a date of birth to /birth-date, from every
 * page of the app (ADR 0020, section 1). Behind its own Suspense boundary, so the
 * shell is still prerendered; the redirect follows as soon as /v1/me answers,
 * which the shell and the page ask for anyway. Not finding out is no reason to
 * lock anyone out: every age rule is the API's, and it treats a missing date as
 * not adult.
 */
async function BirthDateGate() {
  const viewer = await getViewer().catch(() => null)
  if (viewer?.state === 'member' && viewer.me.birthDateNeeded) redirect('/birth-date')
  return null
}
