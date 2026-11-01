import Link from 'next/link'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { getTrendingTopics } from '@/lib/api'

async function Linked({ children, className }: { children: ReactNode; className?: string }) {
  // The same question /topics asks, so the link is there exactly when the page is: for
  // signed-out visitors too, and for nobody while trending topics are switched off.
  // If the API cannot be reached, the words go without the link.
  const trending = await getTrendingTopics().catch(() => null)
  if (!trending) return <>{children}</>
  return (
    <Link href="/topics" className={className}>
      {children}
    </Link>
  )
}

/** A link to /topics that exists only while the topicDiscovery flag is on for the viewer. */
export function TopicsLink(props: { children: ReactNode; className?: string }) {
  return (
    <Suspense fallback={props.children}>
      <Linked {...props} />
    </Suspense>
  )
}
