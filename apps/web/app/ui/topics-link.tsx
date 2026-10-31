import Link from 'next/link'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { getViewer } from '@/lib/api'

async function Linked({ children, className }: { children: ReactNode; className?: string }) {
  const viewer = await getViewer()
  // Signed-out visitors, and anyone while trending topics are switched off, get the words without the link.
  if (viewer.state === 'member' && viewer.me.features?.topicDiscovery) {
    return (
      <Link href="/topics" className={className}>
        {children}
      </Link>
    )
  }
  return <>{children}</>
}

/** A link to /topics that exists only while the topicDiscovery flag is on for the viewer. */
export function TopicsLink(props: { children: ReactNode; className?: string }) {
  return (
    <Suspense fallback={props.children}>
      <Linked {...props} />
    </Suspense>
  )
}
